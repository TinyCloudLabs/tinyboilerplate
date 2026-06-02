import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TinyCloudWeb } from "@tinycloud/web-sdk";
import type { DelegatingServerInfo } from "@tinyboilerplate/core";
import {
  SessionStore,
  checkDelegationStatus,
  clearPersistedSession,
  composeManifestWithBackend,
  connectWallet,
  createAndSignIn,
  createApiClient,
  createManifestDelegation,
  loadAppManifest,
  requestNonce,
  restoreTinyCloudWebSession,
  revokeDelegation,
  sendDelegation,
  verifySession,
  type ApiClient,
} from "@tinyboilerplate/client";

const OPENKEY_HOST = import.meta.env.VITE_OPENKEY_HOST || "https://openkey.so";
const APP_NAME = "TinyCloud Notes";
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || `${globalThis.location?.protocol ?? "http:"}//localhost:3002`;

type AppState =
  | "booting"
  | "unauthenticated"
  | "backendSessionRestored"
  | "connectingIdentity"
  | "fetchingPolicy"
  | "signingTinyCloudSession"
  | "verifyingBackendSession"
  | "checkingDelegation"
  | "loadingNotes"
  | "loadingNote"
  | "needsDelegation"
  | "delegationExpired"
  | "delegationStale"
  | "ready"
  | "searching"
  | "saving"
  | "deleting"
  | "recoverableError";

interface Note {
  id: string;
  title: string;
  url?: string;
  tags: string[];
  bodyKey: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface NoteInput {
  title: string;
  url: string;
  tags: string;
  body: string;
}

const emptyDraft: NoteInput = {
  title: "",
  url: "",
  tags: "",
  body: "",
};

export function App() {
  const sessionStoreRef = useRef(new SessionStore("tinycloud-notes:session"));
  const restoredRef = useRef(false);
  const [state, setState] = useState<AppState>("booting");
  const [address, setAddress] = useState<string | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [providerLive, setProviderLive] = useState(false);
  const [policy, setPolicy] = useState<DelegatingServerInfo | null>(null);
  const [tcw, setTcw] = useState<TinyCloudWeb | null>(null);
  const [api, setApi] = useState<ApiClient | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteInput>(emptyDraft);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId],
  );
  const busy = isBusyState(state);
  const notesAreKnown = api !== null && isNotesDataKnown(state);
  const canEditNotes = api !== null && state === "ready";
  const canRefreshNotes = api !== null && (state === "ready" || state === "searching");
  const shouldShowSignIn = !address || needsLiveProvider(state) || state === "recoverableError";
  const surfaceStatus = getSurfaceStatus(state, error);
  const editorStatus = getEditorStatus(state, error);

  const loadNotes = useCallback(
    async (client = api, query = search, preferredId = selectedId) => {
      if (!client) return;
      const suffix = query.trim() ? `?search=${encodeURIComponent(query.trim())}` : "";
      const result = await client.get<{ notes: Note[] }>(`/api/notes${suffix}`);
      setNotes(result.notes);
      const nextSelected =
        (preferredId && result.notes.find((note) => note.id === preferredId)) ??
        result.notes[0] ??
        null;
      if (nextSelected) {
        setSelectedId(nextSelected.id);
        setDraft(noteToDraft(nextSelected));
      } else {
        setSelectedId(null);
        setDraft(emptyDraft);
      }
    },
    [api, search, selectedId],
  );

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const sessionStore = sessionStoreRef.current;

    if (!sessionStore.hasSession() || sessionStore.isExpired()) {
      setState("unauthenticated");
      return;
    }

    const storedAddress = sessionStore.getAddress();
    const token = sessionStore.getToken();
    if (!storedAddress || !token) {
      sessionStore.clear();
      setState("unauthenticated");
      return;
    }

    (async () => {
      try {
        setState("backendSessionRestored");
        const client = createApiClient(BACKEND_URL, { sessionStore });
        setApi(client);
        setAddress(storedAddress);
        setDid(`did:pkh:eip155:1:${storedAddress}`);
        setProviderLive(false);

        setState("fetchingPolicy");
        const info = await fetchServerInfo();
        setPolicy(info);

        setState("checkingDelegation");
        const delegation = await checkDelegationStatus(BACKEND_URL, token);
        if (delegation.status === "active") {
          const restored = await restoreTinyCloudWebSession(storedAddress, {
            autoCreateSpace: false,
          });
          if (restored.status === "restored") setTcw(restored.tcw);
          setState("loadingNotes");
          await loadNotes(client, "", null);
          setState("ready");
          return;
        }
        if (delegation.status === "expired") setState("delegationExpired");
        else if (delegation.status === "stale") setState("delegationStale");
        else setState("needsDelegation");
      } catch (caught) {
        sessionStore.clear();
        setApi(null);
        setError(errorMessage(caught));
        setState("recoverableError");
      }
    })();
  }, [loadNotes]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      setState("connectingIdentity");
      const { address: connectedAddress, web3Provider } = await connectWallet({
        appName: APP_NAME,
        host: OPENKEY_HOST,
      });
      setAddress(connectedAddress);
      setProviderLive(true);

      setState("fetchingPolicy");
      const [nonce, info, manifest] = await Promise.all([
        requestNonce(BACKEND_URL, connectedAddress),
        fetchServerInfo(),
        loadAppManifest(`${BACKEND_URL}/api/manifest`),
      ]);
      setPolicy(info);
      const composed = composeManifestWithBackend(manifest, info);

      setState("signingTinyCloudSession");
      const { tcw: signedTcw, session } = await createAndSignIn(web3Provider, {
        address: connectedAddress,
        nonce,
        autoCreateSpace: true,
        capabilityRequest: composed,
      });
      setTcw(signedTcw);
      setDid(signedTcw.did ?? null);

      setState("verifyingBackendSession");
      const verified = await verifySession(BACKEND_URL, session.siwe, session.signature);
      sessionStoreRef.current.setSession(verified.token, verified.expiresIn, connectedAddress);
      const client = createApiClient(BACKEND_URL, { sessionStore: sessionStoreRef.current });
      setApi(client);

      setState("checkingDelegation");
      const token = sessionStoreRef.current.getToken();
      if (!token) throw new Error("Backend session token was not stored.");

      const status = await checkDelegationStatus(BACKEND_URL, token).catch(() => ({
        status: "none" as const,
        expiresAt: null,
      }));
      if (status.status !== "active") {
        if (status.status === "expired") setState("delegationExpired");
        else if (status.status === "stale") setState("delegationStale");
        else setState("needsDelegation");
        const { serialized } = await createManifestDelegation(signedTcw, info.did, composed);
        await sendDelegation(BACKEND_URL, serialized, token);
      }

      setState("loadingNotes");
      await loadNotes(client, "", null);
      setState("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  }, [loadNotes]);

  const signOut = useCallback(async () => {
    const token = sessionStoreRef.current.getToken();
    if (token) revokeDelegation(BACKEND_URL, token).catch(() => {});
    if (tcw) await tcw.signOut?.();
    else if (address) clearPersistedSession(address);
    sessionStoreRef.current.clear();
    setAddress(null);
    setDid(null);
    setTcw(null);
    setApi(null);
    setNotes([]);
    setSelectedId(null);
    setDraft(emptyDraft);
    setProviderLive(false);
    setState("unauthenticated");
  }, [address, tcw]);

  const selectNote = async (note: Note) => {
    if (!api || state !== "ready") return;
    setError(null);
    setSelectedId(note.id);
    setDraft(noteToDraft(note));
    setState("loadingNote");
    try {
      const detail = await api.get<{ note: Note }>(`/api/notes/${note.id}`);
      setDraft(noteToDraft(detail.note));
      setState("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  };

  const newNote = () => {
    if (state !== "ready") return;
    setSelectedId(null);
    setDraft(emptyDraft);
  };

  const saveNote = async () => {
    if (!api || state !== "ready") return;
    setError(null);
    setState("saving");
    try {
      let preferredId = selectedId;
      if (selectedId) {
        await api.put(`/api/notes/${selectedId}`, inputPayload(draft));
      } else {
        const created = await api.post<{ note: Note }>("/api/notes", inputPayload(draft));
        preferredId = created.note.id;
      }
      await loadNotes(api, search, preferredId);
      setState("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  };

  const deleteSelected = async () => {
    if (!api || state !== "ready" || !selectedId) return;
    setError(null);
    setState("deleting");
    try {
      await api.del(`/api/notes/${selectedId}`);
      setSelectedId(null);
      setDraft(emptyDraft);
      await loadNotes(api, search, null);
      setState("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  };

  const refreshSearch = async () => {
    if (!api || !canRefreshNotes || state === "searching") return;
    setError(null);
    setState("searching");
    try {
      await loadNotes(api, search);
      setState("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  };

  return (
    <main className="dashboard-shell" data-shell="dashboard">
      <header className="app-header">
        <div>
          <p className="eyebrow">TinyCloud</p>
          <h1>Notes</h1>
        </div>
        <div className="header-actions">
          <ConnectionDetails
            address={address}
            did={did}
            error={error}
            policyHash={policy?.policyHash ?? null}
            providerLive={providerLive}
            state={state}
          />
          {canEditNotes && (
            <button onClick={newNote} disabled={!canEditNotes}>
              New note
            </button>
          )}
          {shouldShowSignIn && (
            <button className="primary" onClick={signIn} disabled={busy}>
              {primaryActionLabel(state, Boolean(needsLiveProvider(state) && address))}
            </button>
          )}
          {(address || state === "recoverableError") && (
            <button onClick={signOut} disabled={busy}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <section className="dashboard-content">
        <div className="notes-grid">
          <section className="panel list-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Library</p>
                <h2>All notes</h2>
              </div>
              <span className="count-pill">{notes.length}</span>
            </div>

            <div className="search-row">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") refreshSearch();
                }}
                placeholder="Search"
                disabled={!canRefreshNotes || state !== "ready"}
              />
              <button onClick={refreshSearch} disabled={!canRefreshNotes || state !== "ready"}>
                {state === "searching" ? "Searching" : "Search"}
              </button>
            </div>

            {surfaceStatus && <SurfaceStatus {...surfaceStatus} />}

            <div className="note-list">
              {!notesAreKnown ? (
                <ListReadiness state={state} />
              ) : notes.length === 0 ? (
                <div className="empty-state">
                  {search.trim() ? "No notes match this search." : "No notes yet."}
                </div>
              ) : (
                notes.map((note) => (
                  <button
                    className={`note-row ${note.id === selectedId ? "selected" : ""}`}
                    key={note.id}
                    onClick={() => selectNote(note)}
                    disabled={!canEditNotes}
                  >
                    <span className="note-row-title">{note.title}</span>
                    <span className="note-row-meta">
                      {note.tags.length > 0 ? note.tags.join(", ") : formatDate(note.updatedAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="panel editor">
            <div className="editor-toolbar">
              <div>
                <p className="eyebrow">
                  {editorStatus ? "Status" : selected ? "Editing" : "New note"}
                </p>
                <h2>{editorStatus ? "Editor" : draft.title || "Untitled"}</h2>
              </div>
              {!editorStatus && (
                <div className="toolbar-actions">
                  <button onClick={deleteSelected} disabled={!canEditNotes || !selectedId}>
                    {state === "deleting" ? "Deleting" : "Delete"}
                  </button>
                  <button
                    className="primary"
                    onClick={saveNote}
                    disabled={!canEditNotes || !draft.title.trim()}
                  >
                    {state === "saving" ? "Saving" : "Save"}
                  </button>
                </div>
              )}
            </div>

            {editorStatus ? (
              <EditorReadiness {...editorStatus} busy={busy} />
            ) : (
              <>
                <label>
                  <span>Title</span>
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    disabled={!canEditNotes}
                  />
                </label>

                <div className="field-grid">
                  <label>
                    <span>URL</span>
                    <input
                      value={draft.url}
                      onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                      disabled={!canEditNotes}
                    />
                  </label>
                  <label>
                    <span>Tags</span>
                    <input
                      value={draft.tags}
                      onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                      disabled={!canEditNotes}
                    />
                  </label>
                </div>

                <label className="body-field">
                  <span>Body</span>
                  <textarea
                    value={draft.body}
                    onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    disabled={!canEditNotes}
                  />
                </label>
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function SurfaceStatus(props: { title: string; body: string; tone?: "default" | "error" }) {
  return (
    <div className={`surface-status ${props.tone ?? "default"}`}>
      <strong>{props.title}</strong>
      <span>{props.body}</span>
    </div>
  );
}

function ListReadiness({ state }: { state: AppState }) {
  return (
    <div className="list-readiness" aria-live="polite">
      <strong>{listReadinessTitle(state)}</strong>
      <span>{listReadinessBody(state)}</span>
      {isBusyState(state) && <SkeletonStack rows={3} />}
    </div>
  );
}

function EditorReadiness(props: {
  busy: boolean;
  title: string;
  body: string;
  tone?: "default" | "error";
}) {
  return (
    <div className={`editor-readiness ${props.tone ?? "default"}`} aria-live="polite">
      <div>
        <strong>{props.title}</strong>
        <span>{props.body}</span>
      </div>
      {props.busy && <SkeletonStack rows={4} />}
    </div>
  );
}

function SkeletonStack({ rows }: { rows: number }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span className="skeleton-line" key={index} />
      ))}
    </div>
  );
}

function ConnectionDetails(props: {
  address: string | null;
  did: string | null;
  error: string | null;
  policyHash: string | null;
  providerLive: boolean;
  state: AppState;
}) {
  return (
    <details className="connection-details">
      <summary>
        <div className={`status-pill ${props.state}`}>{stateLabel(props.state)}</div>
        <span>Connection details</span>
      </summary>

      <div className="connection-panel">
        <StatusRow label="Identity" value={props.providerLive ? "connected" : "not connected"} />
        <StatusRow label="Backend" value={props.address ? "session present" : "no session"} />
        <StatusRow label="Delegation" value={delegationLabel(props.state)} />
        <StatusRow
          label="Policy"
          value={props.policyHash ? short(props.policyHash, 8, 6) : "pending"}
        />
        {props.address && <StatusRow label="Address" value={short(props.address, 8, 6)} />}
        {props.did && <StatusRow label="DID" value={short(props.did, 18, 8)} />}
        {props.error && <p className="error-text">{props.error}</p>}
      </div>
    </details>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

async function fetchServerInfo(): Promise<DelegatingServerInfo> {
  const response = await fetch(`${BACKEND_URL}/api/server-info`);
  if (!response.ok) throw new Error(`Server info failed: ${response.statusText}`);
  return response.json();
}

function inputPayload(draft: NoteInput) {
  return {
    title: draft.title,
    url: draft.url.trim() || undefined,
    tags: draft.tags,
    body: draft.body,
  };
}

function noteToDraft(note: Note): NoteInput {
  return {
    title: note.title,
    url: note.url ?? "",
    tags: note.tags.join(", "),
    body: note.body,
  };
}

function stateLabel(state: AppState) {
  const labels: Record<AppState, string> = {
    booting: "Booting",
    unauthenticated: "Signed out",
    backendSessionRestored: "Backend restored",
    connectingIdentity: "Connecting",
    fetchingPolicy: "Fetching policy",
    signingTinyCloudSession: "Signing TinyCloud",
    verifyingBackendSession: "Verifying backend",
    checkingDelegation: "Checking delegation",
    loadingNotes: "Loading notes",
    loadingNote: "Opening note",
    needsDelegation: "Needs consent",
    delegationExpired: "Consent expired",
    delegationStale: "Policy changed",
    ready: "Ready",
    searching: "Searching",
    saving: "Saving",
    deleting: "Deleting",
    recoverableError: "Needs attention",
  };
  return labels[state];
}

function isBusyState(state: AppState): boolean {
  return (
    state === "booting" ||
    state === "backendSessionRestored" ||
    state === "connectingIdentity" ||
    state === "fetchingPolicy" ||
    state === "signingTinyCloudSession" ||
    state === "verifyingBackendSession" ||
    state === "checkingDelegation" ||
    state === "loadingNotes" ||
    state === "loadingNote" ||
    state === "searching" ||
    state === "saving" ||
    state === "deleting"
  );
}

function isNotesDataKnown(state: AppState): boolean {
  return (
    state === "ready" ||
    state === "searching" ||
    state === "saving" ||
    state === "deleting" ||
    state === "loadingNote"
  );
}

function primaryActionLabel(state: AppState, reconnect: boolean): string {
  const labels: Partial<Record<AppState, string>> = {
    booting: "Starting",
    backendSessionRestored: "Restoring",
    connectingIdentity: "Connecting",
    fetchingPolicy: "Checking",
    signingTinyCloudSession: "Signing in",
    verifyingBackendSession: "Verifying",
    checkingDelegation: "Checking",
    loadingNotes: "Loading notes",
    loadingNote: "Opening",
    searching: "Searching",
    saving: "Saving",
    deleting: "Deleting",
  };
  return (
    labels[state] ??
    (reconnect ? "Reconnect" : state === "recoverableError" ? "Try again" : "Sign in")
  );
}

function getSurfaceStatus(
  state: AppState,
  error: string | null,
): { title: string; body: string; tone?: "default" | "error" } | null {
  const statuses: Partial<
    Record<AppState, { title: string; body: string; tone?: "default" | "error" }>
  > = {
    booting: {
      title: "Starting up",
      body: "Restoring any local session before enabling notes.",
    },
    unauthenticated: {
      title: "Signed out",
      body: "Sign in to create and sync notes with delegated storage.",
    },
    backendSessionRestored: {
      title: "Session found",
      body: "Checking whether the backend session can still be used.",
    },
    connectingIdentity: {
      title: "Connecting identity",
      body: "Finish the OpenKey prompt to continue.",
    },
    fetchingPolicy: {
      title: "Checking policy",
      body: "Loading the backend capability request.",
    },
    signingTinyCloudSession: {
      title: "Signing in",
      body: "Creating a TinyCloud session for Notes.",
    },
    verifyingBackendSession: {
      title: "Verifying session",
      body: "Confirming the signed session with the backend.",
    },
    checkingDelegation: {
      title: "Checking delegation",
      body: "Confirming Notes can reach delegated storage.",
    },
    loadingNotes: {
      title: "Loading notes",
      body: "Fetching the library before enabling the editor.",
    },
    loadingNote: {
      title: "Opening note",
      body: "Loading the selected note body.",
    },
    needsDelegation: {
      title: "Consent needed",
      body: "Reconnect to approve backend access for Notes.",
    },
    delegationExpired: {
      title: "Consent expired",
      body: "Reconnect to refresh backend access.",
    },
    delegationStale: {
      title: "Policy changed",
      body: "Reconnect to approve the current backend policy.",
    },
    searching: {
      title: "Searching",
      body: "Refreshing the library results.",
    },
    saving: {
      title: "Saving",
      body: "Writing the current note changes.",
    },
    deleting: {
      title: "Deleting",
      body: "Removing the selected note and refreshing the library.",
    },
    recoverableError: {
      title: "Needs attention",
      body: error ?? "The last action failed. Try again or sign out.",
      tone: "error",
    },
  };
  return statuses[state] ?? null;
}

function getEditorStatus(
  state: AppState,
  error: string | null,
): { title: string; body: string; tone?: "default" | "error" } | null {
  if (state === "ready" || state === "saving" || state === "searching") return null;
  return getSurfaceStatus(state, error);
}

function listReadinessTitle(state: AppState): string {
  if (state === "unauthenticated") return "Notes locked";
  if (state === "recoverableError") return "Notes paused";
  if (needsLiveProvider(state)) return "Consent needed";
  return "Preparing library";
}

function listReadinessBody(state: AppState): string {
  if (state === "unauthenticated") return "Sign in to load your notes.";
  if (state === "recoverableError") return "Resolve the connection issue before loading notes.";
  if (needsLiveProvider(state)) return "Reconnect to approve backend access.";
  if (state === "loadingNotes") return "Loading notes.";
  return "Waiting for the connection checks to finish.";
}

function delegationLabel(state: AppState) {
  if (
    state === "ready" ||
    state === "loadingNotes" ||
    state === "loadingNote" ||
    state === "searching" ||
    state === "saving" ||
    state === "deleting"
  ) {
    return "active";
  }
  if (state === "delegationExpired") return "expired";
  if (state === "delegationStale") return "stale";
  if (state === "needsDelegation") return "missing";
  return "pending";
}

function needsLiveProvider(state: AppState) {
  return (
    state === "needsDelegation" || state === "delegationExpired" || state === "delegationStale"
  );
}

function short(value: string, head: number, tail: number) {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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
  | "needsDelegation"
  | "delegationExpired"
  | "delegationStale"
  | "ready"
  | "saving"
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
  const canUseNotes = api !== null && (state === "ready" || state === "saving");

  const loadNotes = useCallback(
    async (client = api, query = search) => {
      if (!client) return;
      const suffix = query.trim() ? `?search=${encodeURIComponent(query.trim())}` : "";
      const result = await client.get<{ notes: Note[] }>(`/api/notes${suffix}`);
      setNotes(result.notes);
      if (result.notes.length > 0 && !result.notes.some((note) => note.id === selectedId)) {
        setSelectedId(result.notes[0].id);
        setDraft(noteToDraft(result.notes[0]));
      }
      if (result.notes.length === 0) {
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
          setState("ready");
          await loadNotes(client, "");
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

      setState("ready");
      await loadNotes(client, "");
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
    if (!api) return;
    setSelectedId(note.id);
    const detail = await api.get<{ note: Note }>(`/api/notes/${note.id}`);
    setDraft(noteToDraft(detail.note));
  };

  const newNote = () => {
    setSelectedId(null);
    setDraft(emptyDraft);
  };

  const saveNote = async () => {
    if (!api) return;
    setError(null);
    setState("saving");
    try {
      if (selectedId) {
        await api.put(`/api/notes/${selectedId}`, inputPayload(draft));
      } else {
        const created = await api.post<{ note: Note }>("/api/notes", inputPayload(draft));
        setSelectedId(created.note.id);
      }
      setState("ready");
      await loadNotes(api, search);
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  };

  const deleteSelected = async () => {
    if (!api || !selectedId) return;
    setError(null);
    setState("saving");
    try {
      await api.del(`/api/notes/${selectedId}`);
      setSelectedId(null);
      setDraft(emptyDraft);
      setState("ready");
      await loadNotes(api, search);
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  };

  const refreshSearch = async () => {
    setError(null);
    try {
      await loadNotes(api, search);
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  };

  return (
    <main className="app-shell">
      <section className="sidebar">
        <div className="brand-row">
          <div>
            <p className="eyebrow">TinyCloud</p>
            <h1>Notes</h1>
          </div>
          <button
            className="icon-button"
            onClick={newNote}
            disabled={!canUseNotes}
            title="New note"
          >
            +
          </button>
        </div>

        <ConnectionPanel
          address={address}
          did={did}
          error={error}
          policyHash={policy?.policyHash ?? null}
          providerLive={providerLive}
          state={state}
          onSignIn={signIn}
          onSignOut={signOut}
        />

        <div className="search-row">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") refreshSearch();
            }}
            placeholder="Search"
            disabled={!canUseNotes}
          />
          <button onClick={refreshSearch} disabled={!canUseNotes}>
            Search
          </button>
        </div>

        <div className="note-list">
          {notes.map((note) => (
            <button
              className={`note-row ${note.id === selectedId ? "selected" : ""}`}
              key={note.id}
              onClick={() => selectNote(note)}
            >
              <span className="note-row-title">{note.title}</span>
              <span className="note-row-meta">
                {note.tags.length > 0 ? note.tags.join(", ") : formatDate(note.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="editor">
        <div className="editor-toolbar">
          <div>
            <p className="eyebrow">{selected ? "Editing" : "New note"}</p>
            <h2>{draft.title || "Untitled"}</h2>
          </div>
          <div className="toolbar-actions">
            <button onClick={deleteSelected} disabled={!canUseNotes || !selectedId}>
              Delete
            </button>
            <button
              className="primary"
              onClick={saveNote}
              disabled={!canUseNotes || !draft.title.trim()}
            >
              {state === "saving" ? "Saving" : "Save"}
            </button>
          </div>
        </div>

        <label>
          <span>Title</span>
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            disabled={!canUseNotes}
          />
        </label>

        <div className="field-grid">
          <label>
            <span>URL</span>
            <input
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              disabled={!canUseNotes}
            />
          </label>
          <label>
            <span>Tags</span>
            <input
              value={draft.tags}
              onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
              disabled={!canUseNotes}
            />
          </label>
        </div>

        <label className="body-field">
          <span>Body</span>
          <textarea
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            disabled={!canUseNotes}
          />
        </label>
      </section>
    </main>
  );
}

function ConnectionPanel(props: {
  address: string | null;
  did: string | null;
  error: string | null;
  policyHash: string | null;
  providerLive: boolean;
  state: AppState;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const needsIdentity =
    props.state === "unauthenticated" ||
    props.state === "needsDelegation" ||
    props.state === "delegationExpired" ||
    props.state === "delegationStale" ||
    props.state === "recoverableError";

  return (
    <div className="connection-panel">
      <div className={`status-pill ${props.state}`}>{stateLabel(props.state)}</div>
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
      <div className="connection-actions">
        <button className="primary" onClick={props.onSignIn} disabled={!needsIdentity}>
          {props.address && !props.providerLive ? "Reconnect identity" : "Connect"}
        </button>
        <button onClick={props.onSignOut} disabled={!props.address}>
          Sign out
        </button>
      </div>
    </div>
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
    needsDelegation: "Needs consent",
    delegationExpired: "Consent expired",
    delegationStale: "Policy changed",
    ready: "Ready",
    saving: "Saving",
    recoverableError: "Needs attention",
  };
  return labels[state];
}

function delegationLabel(state: AppState) {
  if (state === "ready" || state === "saving") return "active";
  if (state === "delegationExpired") return "expired";
  if (state === "delegationStale") return "stale";
  if (state === "needsDelegation") return "missing";
  return "pending";
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TinyCloudWeb, Manifest } from "@tinycloud/web-sdk";
import {
  connectWallet,
  createAndSignIn,
  clearPersistedSession,
  restoreTinyCloudWebSession,
} from "@tinyboilerplate/client";
import manifestJson from "../../manifest.json";
import {
  createTask,
  deleteTask,
  listTasks,
  resetTaskStore,
  setTaskDone,
  type Task,
} from "./lib/taskStore";

// Browser-direct: the app signs in with its OWN manifest (no backend to serve it)
// and writes straight to tinycloud.sql. The manifest grants read/write/schema.
const MANIFEST = manifestJson as unknown as Manifest;
const OPENKEY_HOST = import.meta.env.VITE_OPENKEY_HOST || "https://openkey.so";
const APP_NAME = "TinyCloud Tasks";
// Persist just enough to know which account to restore (the SDK holds the session).
const LAST_ADDRESS_KEY = "tinytasks:last-address";

type AppState =
  | "booting"
  | "unauthenticated"
  | "connecting"
  | "signing"
  | "loading"
  | "ready"
  | "mutating"
  | "recoverableError";

export interface TaskSession {
  epoch: number;
  tcw: TinyCloudWeb;
  did: string | null;
}

export interface TaskSessionGate {
  /** Invalidate the active session before a sign-out or a new sign-in attempt. */
  invalidate(): number;
  /** Make a successfully established client active only for its current attempt. */
  activate(tcw: TinyCloudWeb, epoch: number): TaskSession | null;
  /** Whether an async sign-in/restore attempt is still current. */
  isCurrent(epoch: number): boolean;
  /** The currently active session, if any. */
  current(): TaskSession | null;
  /** Whether a refresh completion still belongs to the active client and DID. */
  isActive(session: TaskSession): boolean;
}

function sessionDid(tcw: TinyCloudWeb): string | null {
  return typeof tcw.did === "string" ? tcw.did : null;
}

/**
 * Tracks the client identity as well as an epoch so a completion from a prior
 * account can never update the current account's in-memory task list.
 */
export function createTaskSessionGate(): TaskSessionGate {
  let epoch = 0;
  let active: TaskSession | null = null;

  return {
    invalidate() {
      epoch++;
      active = null;
      return epoch;
    },
    activate(tcw, attemptEpoch) {
      if (attemptEpoch !== epoch) return null;
      active = { epoch: attemptEpoch, tcw, did: sessionDid(tcw) };
      return active;
    },
    isCurrent: (attemptEpoch) => attemptEpoch === epoch,
    current: () => active,
    isActive: (session) =>
      session.epoch === epoch &&
      active === session &&
      active?.tcw === session.tcw &&
      active?.did === session.did &&
      session.did === sessionDid(session.tcw),
  };
}

/** Apply both cache and network list results only while their session is still active. */
export async function refreshTasksForSession(
  sessionGate: TaskSessionGate,
  session: TaskSession,
  client: TinyCloudWeb,
  setTasks: (tasks: Task[]) => void,
): Promise<boolean> {
  const apply = (tasks: Task[]): boolean => {
    if (!sessionGate.isActive(session) || session.tcw !== client) return false;
    setTasks(tasks);
    return true;
  };

  const result = await listTasks(client, (fresh) => {
    apply(fresh);
  });
  return result.status === "applied" && apply(result.tasks);
}

export function App() {
  const restoredRef = useRef(false);
  const sessionGateRef = useRef<TaskSessionGate | null>(null);
  if (!sessionGateRef.current) sessionGateRef.current = createTaskSessionGate();
  const sessionGate = sessionGateRef.current;
  const [state, setState] = useState<AppState>("booting");
  const [tcw, setTcw] = useState<TinyCloudWeb | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy =
    state === "booting" ||
    state === "connecting" ||
    state === "signing" ||
    state === "loading" ||
    state === "mutating";
  const canEdit = tcw !== null && (state === "ready" || state === "mutating");
  const status = getStatus(state, error);

  const refresh = useCallback(
    (client: TinyCloudWeb, session: TaskSession) =>
      refreshTasksForSession(sessionGate, session, client, setTasks),
    [sessionGate],
  );

  // Boot: try to restore a prior browser-direct session (no wallet prompt).
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const restoreEpoch = sessionGate.invalidate();
    const last = safeGet(LAST_ADDRESS_KEY);
    if (!last) {
      setState("unauthenticated");
      return;
    }
    (async () => {
      try {
        const restored = await restoreTinyCloudWebSession(last, {
          manifest: MANIFEST,
          autoCreateSpace: false,
        });
        if (restored.status !== "restored" || !restored.tcw) {
          if (sessionGate.isCurrent(restoreEpoch)) setState("unauthenticated");
          return;
        }
        const session = sessionGate.activate(restored.tcw, restoreEpoch);
        if (!session) return;
        setTcw(restored.tcw);
        setAddress(last);
        setDid(restored.tcw.did ?? null);
        setState("loading");
        await refresh(restored.tcw, session);
        if (sessionGate.isActive(session)) setState("ready");
      } catch {
        if (sessionGate.isCurrent(restoreEpoch)) setState("unauthenticated");
      }
    })();
  }, [refresh, sessionGate]);

  const signIn = useCallback(async () => {
    const signInEpoch = sessionGate.invalidate();
    setError(null);
    try {
      setState("connecting");
      const { address: connected, web3Provider } = await connectWallet({
        appName: APP_NAME,
        host: OPENKEY_HOST,
      });
      if (!sessionGate.isCurrent(signInEpoch)) return;
      setAddress(connected);

      setState("signing");
      const { tcw: signed } = await createAndSignIn(web3Provider, {
        address: connected,
        manifest: MANIFEST,
        autoCreateSpace: true,
      });
      const session = sessionGate.activate(signed, signInEpoch);
      if (!session) return;
      setTcw(signed);
      setDid(signed.did ?? null);
      safeSet(LAST_ADDRESS_KEY, connected);

      setState("loading");
      await refresh(signed, session);
      if (sessionGate.isActive(session)) setState("ready");
    } catch (caught) {
      if (sessionGate.isCurrent(signInEpoch)) {
        setError(errorMessage(caught));
        setState("recoverableError");
      }
    }
  }, [refresh, sessionGate]);

  const signOut = useCallback(async () => {
    const client = tcw;
    const signedAddress = address;
    sessionGate.invalidate();
    if (client) resetTaskStore(client);
    else if (signedAddress) clearPersistedSession(signedAddress);
    safeRemove(LAST_ADDRESS_KEY);
    setTcw(null);
    setAddress(null);
    setDid(null);
    setTasks([]);
    setDraft("");
    setState("unauthenticated");
    await client?.signOut?.();
  }, [tcw, address, sessionGate]);

  const addTask = useCallback(async () => {
    const title = draft.trim();
    const session = sessionGate.current();
    if (!tcw || !session || session.tcw !== tcw || !title || state !== "ready") return;
    setError(null);
    setState("mutating");
    try {
      await createTask(tcw, title);
      setDraft("");
      await refresh(tcw, session);
      if (sessionGate.isActive(session)) setState("ready");
    } catch (caught) {
      if (sessionGate.isActive(session)) {
        setError(errorMessage(caught));
        setState("recoverableError");
      }
    }
  }, [draft, tcw, state, refresh, sessionGate]);

  const toggle = useCallback(
    async (task: Task) => {
      const session = sessionGate.current();
      if (!tcw || !session || session.tcw !== tcw || state !== "ready") return;
      setError(null);
      setState("mutating");
      try {
        await setTaskDone(tcw, task.id, !task.done);
        await refresh(tcw, session);
        if (sessionGate.isActive(session)) setState("ready");
      } catch (caught) {
        if (sessionGate.isActive(session)) {
          setError(errorMessage(caught));
          setState("recoverableError");
        }
      }
    },
    [tcw, state, refresh, sessionGate],
  );

  const remove = useCallback(
    async (task: Task) => {
      const session = sessionGate.current();
      if (!tcw || !session || session.tcw !== tcw || state !== "ready") return;
      setError(null);
      setState("mutating");
      try {
        await deleteTask(tcw, task.id);
        await refresh(tcw, session);
        if (sessionGate.isActive(session)) setState("ready");
      } catch (caught) {
        if (sessionGate.isActive(session)) {
          setError(errorMessage(caught));
          setState("recoverableError");
        }
      }
    },
    [tcw, state, refresh, sessionGate],
  );

  const remaining = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);

  return (
    <main className="shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">TinyCloud · browser-direct</p>
          <h1>Tasks</h1>
        </div>
        <div className="header-actions">
          <ConnectionDetails address={address} did={did} state={state} error={error} />
          {(!address || state === "recoverableError") && (
            <button className="primary" onClick={signIn} disabled={busy}>
              {state === "recoverableError" ? "Try again" : "Sign in"}
            </button>
          )}
          {address && (
            <button onClick={signOut} disabled={busy}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <section className="panel">
        {canEdit && (
          <div className="add-row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTask();
              }}
              placeholder="Add a task"
              disabled={state !== "ready"}
            />
            <button
              className="primary"
              onClick={addTask}
              disabled={state !== "ready" || !draft.trim()}
            >
              Add
            </button>
          </div>
        )}

        {status ? (
          <div className={`status ${status.tone ?? "default"}`} aria-live="polite">
            <strong>{status.title}</strong>
            <span>{status.body}</span>
          </div>
        ) : tasks.length === 0 ? (
          <div className="empty">No tasks yet. Add one above.</div>
        ) : (
          <>
            <ul className="task-list">
              {tasks.map((task) => (
                <li key={task.id} className={task.done ? "done" : ""}>
                  <label>
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => toggle(task)}
                      disabled={state !== "ready"}
                    />
                    <span>{task.title}</span>
                  </label>
                  <button
                    className="link"
                    onClick={() => remove(task)}
                    disabled={state !== "ready"}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <p className="count">{remaining} remaining</p>
          </>
        )}
      </section>
    </main>
  );
}

function ConnectionDetails(props: {
  address: string | null;
  did: string | null;
  state: AppState;
  error: string | null;
}) {
  return (
    <details className="connection-details">
      <summary>
        <span className={`status-pill ${props.state}`}>{stateLabel(props.state)}</span>
        <span>Connection details</span>
      </summary>
      <div className="connection-panel">
        <Row label="Session" value={props.address ? "signed in" : "signed out"} />
        <Row label="Storage" value="browser-direct (tcw.sql)" />
        {props.address && <Row label="Address" value={short(props.address, 8, 6)} />}
        {props.did && <Row label="DID" value={short(props.did, 18, 8)} />}
        {props.error && <p className="error-text">{props.error}</p>}
      </div>
    </details>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

function getStatus(
  state: AppState,
  error: string | null,
): { title: string; body: string; tone?: "default" | "error" } | null {
  const map: Partial<
    Record<AppState, { title: string; body: string; tone?: "default" | "error" }>
  > = {
    booting: { title: "Starting up", body: "Restoring any local session." },
    unauthenticated: { title: "Signed out", body: "Sign in to load and sync your tasks." },
    connecting: { title: "Connecting", body: "Finish the OpenKey prompt to continue." },
    signing: { title: "Signing in", body: "Creating a TinyCloud session for Tasks." },
    loading: { title: "Loading tasks", body: "Reading directly from your space." },
    recoverableError: {
      title: "Needs attention",
      body: error ?? "The last action failed. Try again or sign out.",
      tone: "error",
    },
  };
  return map[state] ?? null;
}

function stateLabel(state: AppState): string {
  const labels: Record<AppState, string> = {
    booting: "Booting",
    unauthenticated: "Signed out",
    connecting: "Connecting",
    signing: "Signing in",
    loading: "Loading",
    ready: "Ready",
    mutating: "Saving",
    recoverableError: "Needs attention",
  };
  return labels[state];
}

function short(value: string, head: number, tail: number): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

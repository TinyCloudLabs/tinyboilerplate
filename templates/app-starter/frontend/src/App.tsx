import { useCallback, useEffect, useRef, useState } from "react";
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
const APP_NAME = "TinyCloud App Starter";
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || `${globalThis.location?.protocol ?? "http:"}//localhost:3003`;

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

type DelegationStatus = "none" | "expired" | "stale" | "active";

interface ProbeValue {
  value: string;
  updatedAt: string;
}

export function App() {
  const sessionStoreRef = useRef(new SessionStore("tinycloud-app-starter:session"));
  const restoredRef = useRef(false);
  const [state, setState] = useState<AppState>("booting");
  const [address, setAddress] = useState<string | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [providerLive, setProviderLive] = useState(false);
  const [policy, setPolicy] = useState<DelegatingServerInfo | null>(null);
  const [delegationStatus, setDelegationStatus] = useState<DelegationStatus>("none");
  const [tcw, setTcw] = useState<TinyCloudWeb | null>(null);
  const [api, setApi] = useState<ApiClient | null>(null);
  const [probe, setProbe] = useState<ProbeValue | null>(null);
  const [probeInput, setProbeInput] = useState("TinyCloud delegated KV is online.");
  const [error, setError] = useState<string | null>(null);

  const busy = isBusyState(state);
  const canUseProbe = api !== null && (state === "ready" || state === "saving");
  const needsLiveProvider =
    state === "needsDelegation" || state === "delegationExpired" || state === "delegationStale";
  const shouldShowSignIn = !address || needsLiveProvider || state === "recoverableError";
  const surfaceStatus = getSurfaceStatus(state, error);

  const fetchPolicy = useCallback(async () => {
    const response = await fetch(`${BACKEND_URL}/api/server-info`);
    if (!response.ok) throw new Error("Failed to load backend policy.");
    return (await response.json()) as DelegatingServerInfo;
  }, []);

  const loadProbe = useCallback(
    async (client = api) => {
      if (!client) return;
      const result = await client.get<{ probe: ProbeValue | null }>("/api/probe");
      setProbe(result.probe);
      if (result.probe) setProbeInput(result.probe.value);
    },
    [api],
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
        const info = await fetchPolicy();
        setPolicy(info);

        setState("checkingDelegation");
        const delegation = await checkDelegationStatus(BACKEND_URL, token);
        setDelegationStatus(delegation.status);
        if (delegation.status === "active") {
          const restored = await restoreTinyCloudWebSession(storedAddress, {
            autoCreateSpace: false,
          });
          if (restored.status === "restored") setTcw(restored.tcw);
          setState("ready");
          await loadProbe(client);
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
  }, [fetchPolicy, loadProbe]);

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
        fetchPolicy(),
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
      setDelegationStatus(status.status);
      if (status.status !== "active") {
        const { serialized } = await createManifestDelegation(signedTcw, info.did, composed);
        await sendDelegation(BACKEND_URL, serialized, token);
        setDelegationStatus("active");
      }

      setState("ready");
      await loadProbe(client);
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  }, [fetchPolicy, loadProbe]);

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
    setProbe(null);
    setProviderLive(false);
    setDelegationStatus("none");
    setState("unauthenticated");
  }, [address, tcw]);

  const saveProbe = async () => {
    if (!api) return;
    setError(null);
    setState("saving");
    try {
      const result = await api.put<{ probe: ProbeValue }>("/api/probe", { value: probeInput });
      setProbe(result.probe);
      setState("ready");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("recoverableError");
    }
  };

  const deleteProbeValue = async () => {
    if (!api) return;
    setError(null);
    setState("saving");
    try {
      await api.del("/api/probe");
      setProbe(null);
      setProbeInput("");
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
          <h1>App Starter</h1>
        </div>
        <div className="header-actions">
          <ConnectionDetails
            address={address}
            delegationStatus={delegationStatus}
            did={did}
            error={error}
            policyHash={policy?.policyHash ?? null}
            providerLive={providerLive}
            state={state}
          />
          {shouldShowSignIn && (
            <button className="primary" onClick={signIn} disabled={busy}>
              {primaryActionLabel(state, Boolean(needsLiveProvider && address))}
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
        <section className="panel work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Delegated KV Probe</p>
              <h2>{probe ? "Probe value stored" : "Probe value empty"}</h2>
            </div>
            <button onClick={() => loadProbe()} disabled={!canUseProbe || state === "saving"}>
              Refresh
            </button>
          </div>

          {surfaceStatus && <SurfaceStatus {...surfaceStatus} />}

          <label className="field-label probe-field">
            <span>Value</span>
            <textarea
              maxLength={1024}
              value={probeInput}
              onChange={(event) => setProbeInput(event.target.value)}
              disabled={!canUseProbe}
            />
          </label>

          <div className="probe-footer">
            <div className="probe-meta">
              <span>{probeInput.length}/1024</span>
              <span>{probe?.updatedAt ? formatDate(probe.updatedAt) : "Not stored"}</span>
            </div>
            <div className="action-row">
              <button
                onClick={deleteProbeValue}
                disabled={!canUseProbe || state === "saving" || !probe}
              >
                Delete
              </button>
              <button
                className="primary"
                onClick={saveProbe}
                disabled={!canUseProbe || state === "saving"}
              >
                {state === "saving" ? "Saving" : "Save probe"}
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function ConnectionDetails(props: {
  address: string | null;
  delegationStatus: DelegationStatus;
  did: string | null;
  error: string | null;
  policyHash: string | null;
  providerLive: boolean;
  state: AppState;
}) {
  return (
    <details className="connection-details">
      <summary>
        <span className={`status-pill ${props.state}`}>{stateLabel(props.state)}</span>
        <span>Connection details</span>
      </summary>
      <div className="connection-panel">
        <StatusRow label="Provider" value={props.providerLive ? "live" : "not connected"} />
        <StatusRow label="Delegation" value={props.delegationStatus} />
        <StatusRow label="Address" value={props.address ?? "none"} mono />
        <StatusRow label="DID" value={props.did ?? "none"} mono />
        <StatusRow label="Policy" value={props.policyHash ?? "not fetched"} mono />
        {props.error && <p className="error-text">{props.error}</p>}
      </div>
    </details>
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

function StatusRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="status-row">
      <span>{props.label}</span>
      {props.mono ? <code>{props.value}</code> : <strong>{props.value}</strong>}
    </div>
  );
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
    state === "saving"
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
    saving: "Saving",
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
      body: "Restoring any local session before enabling the probe.",
    },
    unauthenticated: {
      title: "Signed out",
      body: "Sign in to use delegated storage from this starter.",
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
      body: "Creating a TinyCloud session for this app.",
    },
    verifyingBackendSession: {
      title: "Verifying session",
      body: "Confirming the signed session with the backend.",
    },
    checkingDelegation: {
      title: "Checking delegation",
      body: "Confirming this app can reach its delegated KV storage.",
    },
    needsDelegation: {
      title: "Consent needed",
      body: "Reconnect to approve backend access for this app.",
    },
    delegationExpired: {
      title: "Consent expired",
      body: "Reconnect to refresh backend access.",
    },
    delegationStale: {
      title: "Policy changed",
      body: "Reconnect to approve the current backend policy.",
    },
    saving: {
      title: "Saving",
      body: "Writing the probe value to delegated storage.",
    },
    recoverableError: {
      title: "Needs attention",
      body: error ?? "The last action failed. Try again or sign out.",
      tone: "error",
    },
  };
  return statuses[state] ?? null;
}

function stateLabel(state: AppState): string {
  return state.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const { message, error: code } = error as { message?: unknown; error?: unknown };
    if (typeof message === "string" && message) return message;
    if (typeof code === "string" && code) return code;
    try {
      return JSON.stringify(error);
    } catch {
      return "Unexpected error";
    }
  }
  return typeof error === "string" && error ? error : "Unexpected error";
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { TinyCloudWeb } from "@tinycloud/web-sdk";
import type OpenKey from "@openkey/sdk";
import {
  openKeySignIn,
  createAndSignIn,
  createApiClient,
  signOut,
  TokenStore,
  createLocalStoragePersistence,
  type ApiClient,
} from "@tinyboilerplate/client";

import { AuthPanel } from "./components/AuthPanel";
import { DelegationPanel } from "./components/DelegationPanel";
import { ItemsCRUD } from "./components/ItemsCRUD";

// ── Environment ─────────────────────────────────────────────────────

const OPENKEY_HOST =
  import.meta.env.VITE_OPENKEY_HOST || "https://openkey.so";
const OPENKEY_CLIENT_ID =
  import.meta.env.VITE_OPENKEY_CLIENT_ID || "";
const TINYCLOUD_HOST =
  import.meta.env.VITE_TINYCLOUD_HOST || "https://node.tinycloud.xyz";
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

// ── Token store with localStorage persistence ───────────────────────
// Tokens survive page reloads. Remove the persistence option to revert
// to in-memory-only behavior.

const tokenStore = new TokenStore({
  persistence: createLocalStoragePersistence(),
});

// ── App ─────────────────────────────────────────────────────────────

export function App() {

  // Auth state
  const [address, setAddress] = useState<string | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [tcw, setTcw] = useState<TinyCloudWeb | null>(null);
  const [api, setApi] = useState<ApiClient | null>(null);
  const [openkey, setOpenkey] = useState<OpenKey | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Delegation state
  const [delegationActive, setDelegationActive] = useState(false);

  // ── Sign In ───────────────────────────────────────────────────────

  const handleSignIn = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);

    try {
      // 1. OpenKey sign-in — single popup, passkey auth
      const { address: addr, web3Provider, openkey: okInstance } = await openKeySignIn({
        host: OPENKEY_HOST,
      });

      // 2. TinyCloud sign-in — SIWE signed via OpenKey
      const tcwInstance = await createAndSignIn(web3Provider, {
        tinycloudHosts: [TINYCLOUD_HOST],
        autoCreateSpace: true,
      });

      // 3. Create API client for backend calls
      const apiClient = createApiClient(BACKEND_URL, { userAddress: addr });

      // 4. Start proactive token refresh (opt-in background timer)
      if (OPENKEY_CLIENT_ID) {
        tokenStore.startAutoRefresh({
          openKeyHost: OPENKEY_HOST,
          clientId: OPENKEY_CLIENT_ID,
        });
      }

      // Update state
      setAddress(addr);
      setDid(tcwInstance.did ?? null);
      setTcw(tcwInstance);
      setApi(apiClient);
      setOpenkey(okInstance);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthLoading(false);
    }
  }, []);

  // ── Restore session on mount ─────────────────────────────────────
  // If tokens were persisted from a previous session, restore them.
  // Note: This only restores the JWT tokens — TinyCloud session (tcw)
  // still requires a fresh sign-in. A full session restore would need
  // additional work to reconnect the TinyCloud web SDK.

  useEffect(() => {
    if (tokenStore.restore()) {
      console.log("[App] Restored tokens from localStorage");
      // Tokens are available but TinyCloud session needs re-auth.
      // In a production app, you might auto-trigger sign-in here.
    }
  }, []);

  // ── Auth state change listener ─────────────────────────────────
  // Subscribe to token lifecycle events. Use this to drive reactive UI
  // updates (e.g., redirect to login on session loss).

  useEffect(() => {
    const unsub = tokenStore.onAuthStateChange((event) => {
      console.log("[auth]", event.type);
      if (event.type === "tokens_cleared") {
        // Session ended — could auto-redirect to login, update UI, etc.
      }
      if (event.type === "refresh_failed") {
        setAuthError("Session expired. Please sign in again.");
      }
    });
    return unsub;
  }, []);

  // ── Sign Out ──────────────────────────────────────────────────────

  const handleSignOut = useCallback(async () => {
    const errors = await signOut({
      api: api ?? undefined,
      tcw: tcw ?? undefined,
      tokenStore,
      openkey: openkey ?? undefined,
    });

    if (errors.length > 0) {
      console.warn("[App] Sign-out completed with errors:", errors);
    }

    // Clear React state
    setAddress(null);
    setDid(null);
    setTcw(null);
    setApi(null);
    setOpenkey(null);
    setDelegationActive(false);
    setAuthError(null);
  }, [tcw, api, openkey]);

  // ── Render ────────────────────────────────────────────────────────

  const isSignedIn = address !== null && tcw !== null;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>TinyBoilerplate</h1>
        <p style={styles.subtitle}>React + Express Example</p>
      </header>

      <main style={styles.main}>
        <AuthPanel
          isSignedIn={isSignedIn}
          address={address}
          did={did}
          loading={authLoading}
          error={authError}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
        />

        <DelegationPanel
          isSignedIn={isSignedIn}
          tcw={tcw}
          backendUrl={BACKEND_URL}
          userAddress={address}
          onStatusChange={setDelegationActive}
        />

        <ItemsCRUD
          api={api}
          delegationActive={delegationActive}
        />
      </main>

      <footer style={styles.footer}>
        <p>
          Powered by{" "}
          <a href="https://tinycloud.xyz" target="_blank" rel="noreferrer">
            TinyCloud
          </a>{" "}
          &{" "}
          <a href="https://openkey.so" target="_blank" rel="noreferrer">
            OpenKey
          </a>
        </p>
      </footer>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "24px 16px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: "#1a1a1a",
    lineHeight: 1.5,
  },
  header: {
    textAlign: "center",
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    margin: "4px 0 0",
  },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  footer: {
    textAlign: "center",
    marginTop: 48,
    fontSize: 13,
    color: "#999",
  },
};

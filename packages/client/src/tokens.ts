import { DEFAULT_FETCH_TIMEOUT_MS } from "@tinyboilerplate/core";
import type { TokenPersistence } from "./persistence.js";
import type { AuthEvent, AuthEventListener, Unsubscribe } from "./auth-events.js";

// ── Types ────────────────────────────────────────────────────────────

export interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // Unix timestamp in ms
}

export interface TokenRefreshConfig {
  /** OpenKey host, e.g. "https://openkey.so" */
  openKeyHost: string;
  /** OAuth client ID */
  clientId: string;
}

export interface TokenStoreConfig {
  /** Optional persistence layer for surviving page reloads. */
  persistence?: TokenPersistence;
}

// ── Token Store ──────────────────────────────────────────────────────

/**
 * JWT token store with refresh logic and optional persistence.
 * Framework-agnostic: wire into React state, Vue refs, or any other system.
 *
 * Without persistence (default), tokens are in-memory only and lost on page reload.
 * Pass a `TokenPersistence` implementation to survive reloads:
 *
 * ```ts
 * import { TokenStore, createLocalStoragePersistence } from "@tinyboilerplate/client";
 *
 * const store = new TokenStore({
 *   persistence: createLocalStoragePersistence(),
 * });
 * store.restore(); // attempt to load persisted tokens on startup
 * ```
 */
export class TokenStore {
  private tokens: StoredTokens | null = null;
  private readonly persistence?: TokenPersistence;
  private readonly listeners = new Set<AuthEventListener>();

  constructor(config?: TokenStoreConfig) {
    this.persistence = config?.persistence;
  }

  // ── Event Subscription ──────────────────────────────────────────────

  /**
   * Subscribe to auth state changes. Returns an unsubscribe function.
   *
   * Events:
   * - `tokens_set` — tokens were stored (sign-in or refresh)
   * - `tokens_restored` — tokens loaded from persistence
   * - `tokens_cleared` — tokens removed (sign-out or session lost)
   * - `refresh_failed` — token refresh attempt failed (followed by `tokens_cleared`)
   *
   * Framework-agnostic — wire into React useState, Vue ref, Svelte store, etc.
   */
  onAuthStateChange(listener: AuthEventListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Emit an event to all registered listeners. Swallows listener errors. */
  private emit(event: AuthEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Swallow listener errors — one bad listener must not break the store.
      }
    }
  }

  /** Buffer before actual expiry to trigger refresh (30 seconds). */
  private static readonly EXPIRY_BUFFER_MS = 30_000;

  /**
   * Store tokens from an OAuth flow or refresh response.
   * `expiresIn` is in seconds (as returned by OAuth token endpoints).
   * Empty-string refreshToken is normalized to null.
   */
  setTokens(accessToken: string, refreshToken: string | null, expiresIn: number): void {
    this.tokens = {
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    this.persistence?.save(this.tokens);
    this.emit({ type: "tokens_set" });
  }

  /** Get the current access token, or null if not set. */
  getAccessToken(): string | null {
    return this.tokens?.accessToken ?? null;
  }

  /** Get the current refresh token, or null if not set. */
  getRefreshToken(): string | null {
    return this.tokens?.refreshToken ?? null;
  }

  /** Check whether tokens have been set. */
  hasTokens(): boolean {
    return this.tokens !== null;
  }

  /**
   * Returns true if the access token is expired or about to expire
   * (within EXPIRY_BUFFER_MS).
   */
  isExpired(): boolean {
    if (!this.tokens) return true;
    return Date.now() >= this.tokens.expiresAt - TokenStore.EXPIRY_BUFFER_MS;
  }

  /** Clear all stored tokens (e.g., on sign-out). */
  clear(): void {
    this.tokens = null;
    this.persistence?.clear();
    this.emit({ type: "tokens_cleared" });
  }

  /**
   * Attempt to restore tokens from the persistence layer.
   * Returns true if valid (non-expired) tokens were restored.
   * Returns false if no persistence is configured, no tokens are stored,
   * or the stored tokens are expired.
   */
  restore(): boolean {
    if (!this.persistence) return false;

    const loaded = this.persistence.load();
    if (!loaded) return false;

    // Check if the loaded tokens are expired (using the same buffer logic)
    if (Date.now() >= loaded.expiresAt - TokenStore.EXPIRY_BUFFER_MS) {
      // Expired tokens — clear them from persistence too
      this.persistence.clear();
      return false;
    }

    this.tokens = loaded;
    this.emit({ type: "tokens_restored" });
    return true;
  }

  /**
   * Refresh the access token using the stored refresh token.
   * Calls the OpenKey token endpoint with grant_type=refresh_token.
   */
  async refresh(config: TokenRefreshConfig): Promise<void> {
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) {
      throw new Error("No refresh token available");
    }

    const res = await fetch(`${config.openKeyHost}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
      }),
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Emit refresh_failed before clearing (clear emits tokens_cleared)
      const text = await res.text().catch(() => res.statusText);
      const error = new Error(`Token refresh failed: ${text}`);
      this.emit({ type: "refresh_failed", error });
      this.clear();
      throw error;
    }

    const data = await res.json();
    this.setTokens(
      data.access_token,
      data.refresh_token || refreshToken, // Keep old token if server returns empty/missing
      data.expires_in,
    );
  }
}

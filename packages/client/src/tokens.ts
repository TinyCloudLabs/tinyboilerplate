import { DEFAULT_FETCH_TIMEOUT_MS, TokenError } from "@tinyboilerplate/core";
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

/**
 * Options for the proactive background token refresh timer.
 *
 * The timer periodically checks whether the access token should be refreshed
 * and, if so, calls `refresh()` in the background. Fully opt-in — the timer
 * never starts unless you call `startAutoRefresh()`.
 */
export interface AutoRefreshOptions {
  /** How often to check whether a refresh is needed (default: 60 000 ms / 1 min). */
  intervalMs?: number;
  /**
   * Fraction of token lifetime at which to trigger a refresh (0-1).
   * For example, 0.8 means "refresh after 80 % of the lifetime has elapsed".
   * Default: 0.8.
   */
  refreshAtLifetimeFraction?: number;
  /**
   * Absolute minimum time before expiry at which to trigger a refresh.
   * If the remaining time is less than this value a refresh is attempted
   * regardless of the lifetime fraction.
   * Default: 300 000 ms (5 min).
   */
  minTimeBeforeExpiryMs?: number;
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

  // ── Auto-refresh state ──────────────────────────────────────────────
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInProgress = false;
  private tokenLifetimeMs: number | null = null;

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
    this.tokenLifetimeMs = expiresIn * 1000;
    this.tokens = {
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt: Date.now() + this.tokenLifetimeMs,
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
    this.stopAutoRefresh();
    this.tokens = null;
    this.tokenLifetimeMs = null;
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
    // Approximate lifetime from remaining time — we do not know the original
    // expiresIn that was used, so the remaining time is our best guess.
    this.tokenLifetimeMs = loaded.expiresAt - Date.now();
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
      throw new TokenError("No refresh token available");
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
      const error = new TokenError(`Token refresh failed: ${text}`);
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

  // ── Proactive Auto-Refresh ──────────────────────────────────────────

  /** Default auto-refresh options. */
  private static readonly AUTO_REFRESH_DEFAULTS: Required<AutoRefreshOptions> = {
    intervalMs: 60_000,
    refreshAtLifetimeFraction: 0.8,
    minTimeBeforeExpiryMs: 5 * 60_000,
  };

  /**
   * Start a background timer that proactively refreshes the access token
   * before it expires. The timer is fully opt-in and must be stopped
   * explicitly (via `stopAutoRefresh()`) or implicitly (via `clear()`).
   *
   * If a timer is already running it will be stopped and replaced.
   */
  startAutoRefresh(
    refreshConfig: TokenRefreshConfig,
    options?: AutoRefreshOptions,
  ): void {
    // Stop any previously running timer
    this.stopAutoRefresh();

    const opts = { ...TokenStore.AUTO_REFRESH_DEFAULTS, ...options };

    this.autoRefreshTimer = setInterval(() => {
      void this.maybeRefresh(refreshConfig, opts);
    }, opts.intervalMs);
  }

  /** Stop the background auto-refresh timer (if running). */
  stopAutoRefresh(): void {
    if (this.autoRefreshTimer !== null) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  /** Returns `true` if the auto-refresh timer is currently running. */
  isAutoRefreshRunning(): boolean {
    return this.autoRefreshTimer !== null;
  }

  /**
   * Check whether a proactive refresh is needed and, if so, execute it.
   * Concurrent calls are debounced — only the first in-flight refresh runs.
   */
  private async maybeRefresh(
    config: TokenRefreshConfig,
    opts: Required<AutoRefreshOptions>,
  ): Promise<void> {
    // Nothing to refresh
    if (!this.tokens) return;
    // No refresh token means we cannot refresh
    if (!this.tokens.refreshToken) return;
    // Another refresh is already in progress
    if (this.refreshInProgress) return;

    const now = Date.now();
    const remaining = this.tokens.expiresAt - now;
    const lifetime = this.tokenLifetimeMs ?? remaining;

    // Determine whether we should refresh:
    //   1. Remaining time is less than `minTimeBeforeExpiryMs`, OR
    //   2. We have consumed more than `refreshAtLifetimeFraction` of the
    //      token's lifetime.
    const elapsedFraction = lifetime > 0 ? 1 - remaining / lifetime : 1;
    const needsRefresh =
      remaining <= opts.minTimeBeforeExpiryMs ||
      elapsedFraction >= opts.refreshAtLifetimeFraction;

    if (!needsRefresh) return;

    this.refreshInProgress = true;
    try {
      await this.refresh(config);
    } catch {
      // refresh() already emits `refresh_failed` and calls `clear()` which
      // stops the timer, so there is nothing more to do here.
    } finally {
      this.refreshInProgress = false;
    }
  }
}

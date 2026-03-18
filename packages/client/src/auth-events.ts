// ── Auth State Events ────────────────────────────────────────────────

/**
 * Events emitted by TokenStore when auth state changes.
 *
 * Consumers can map these to their own UI states:
 * - First `tokens_set` after app load → "signed in"
 * - Subsequent `tokens_set` → "token refreshed"
 * - `tokens_restored` → session recovered from persistence
 * - `tokens_cleared` → "signed out"
 * - `refresh_failed` → "session lost" (tokens are also cleared after this)
 */
export type AuthEvent =
  | { type: "tokens_set" }
  | { type: "tokens_restored" }
  | { type: "tokens_cleared" }
  | { type: "refresh_failed"; error: Error };

/** Callback invoked when auth state changes. */
export type AuthEventListener = (event: AuthEvent) => void;

/** Function to unsubscribe a previously registered listener. */
export type Unsubscribe = () => void;

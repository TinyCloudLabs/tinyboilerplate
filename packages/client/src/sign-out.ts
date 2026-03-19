import type { TinyCloudWeb } from "@tinycloud/web-sdk";
import type OpenKey from "@openkey/sdk";
import type { TokenStore } from "./tokens.js";
import type { ApiClient } from "./api.js";
import { revokeDelegation } from "./delegation.js";

// ── Types ────────────────────────────────────────────────────────────

export interface SignOutConfig {
  /** Token store to clear (clears in-memory + persistence). */
  tokenStore?: TokenStore;
  /** TinyCloudWeb instance to sign out. */
  tcw?: TinyCloudWeb;
  /** OpenKey instance to disconnect. */
  openkey?: OpenKey;
  /** API client for revoking delegation on the backend. */
  api?: ApiClient;
}

// ── Coordinated Sign-Out ─────────────────────────────────────────────

/**
 * Coordinated sign-out: revokes delegation, signs out of TinyCloud,
 * clears tokens, and disconnects OpenKey.
 *
 * All steps are best-effort — failures are collected, not thrown.
 * Returns an array of errors for any steps that failed.
 *
 * **Order matters:**
 * 1. Revoke delegation (while tokens are still valid for the API call)
 * 2. Sign out of TinyCloud
 * 3. Clear tokens (including persistence)
 * 4. Disconnect OpenKey
 */
export async function signOut(config: SignOutConfig): Promise<Error[]> {
  const errors: Error[] = [];

  // 1. Revoke delegation on backend (while tokens still valid)
  if (config.api) {
    try {
      await revokeDelegation(config.api);
    } catch (err) {
      errors.push(new Error("Failed to revoke delegation", { cause: err }));
    }
  }

  // 2. Sign out of TinyCloud
  if (config.tcw) {
    try {
      config.tcw.signOut?.();
    } catch (err) {
      errors.push(new Error("Failed to sign out of TinyCloud", { cause: err }));
    }
  }

  // 3. Clear tokens (including persistence)
  if (config.tokenStore) {
    config.tokenStore.clear();
  }

  // 4. Disconnect OpenKey
  if (config.openkey) {
    try {
      config.openkey.disconnect?.();
    } catch (err) {
      errors.push(new Error("Failed to disconnect OpenKey", { cause: err }));
    }
  }

  return errors;
}

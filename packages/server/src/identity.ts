import { TinyCloudNode, type Manifest } from "@tinycloud/node-sdk";

// ── Configuration ────────────────────────────────────────────────────

export interface BackendIdentityConfig {
  /** Ethereum private key with 0x prefix */
  privateKey: string;
  /** TinyCloud node host */
  host?: string;
  /** KV key prefix for backend data */
  prefix: string;
  /** Automatically create a space if one doesn't exist */
  autoCreateSpace?: boolean;
}

export interface BackendIdentity {
  node: TinyCloudNode;
  did: string;
}

// ── Create Backend Identity ──────────────────────────────────────────

export function validateBackendPrefix(prefix: string | undefined): string {
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new Error(
      "createBackendIdentity requires an explicit prefix for backend-owned operational state",
    );
  }

  if (prefix.includes("/") || prefix.includes("\\")) {
    throw new Error("createBackendIdentity prefix must be slash- and backslash-free");
  }

  return prefix;
}

/** KV prefix in the backend's own space where {@link DelegationStore} keeps user delegations. */
export const DELEGATION_KEY_PREFIX = "delegations/";

/**
 * Backend session lifetime: 7 days, the pinned SDK's default, set explicitly
 * so an SDK upgrade cannot change it silently.
 */
export const BACKEND_SESSION_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What the backend's own session may do in its own space: read, write and
 * delete stored user delegations. Activating a user's delegation needs no
 * grant here; it is rooted in the user's signature.
 */
export function backendIdentityManifest(prefix: string): Manifest {
  return {
    app_id: prefix,
    name: "Backend identity",
    space: prefix,
    prefix: "",
    defaults: false,
    includePublicSpace: false,
    permissions: [
      { service: "tinycloud.kv", path: DELEGATION_KEY_PREFIX, actions: ["get", "put", "del"] },
    ],
  };
}

/**
 * Initialize a TinyCloudNode instance with the given private key,
 * sign in, and return the node + its DID.
 *
 * This is the backend's own identity — used to store delegations
 * and access user data via delegated capabilities. Its session holds
 * only {@link backendIdentityManifest}.
 */
export async function createBackendIdentity(
  config: BackendIdentityConfig,
): Promise<BackendIdentity> {
  const prefix = validateBackendPrefix(config.prefix);
  const node = new TinyCloudNode({
    privateKey: config.privateKey,
    host: config.host ?? "https://node.tinycloud.xyz",
    prefix,
    autoCreateSpace: config.autoCreateSpace ?? true,
    manifest: backendIdentityManifest(prefix),
    sessionExpirationMs: BACKEND_SESSION_EXPIRATION_MS,
    // The backend never uses account, secrets, or registry state; skip
    // first-account bootstrap and the registry grants it would need.
    autoBootstrapAccount: false,
    includeAccountRegistryPermissions: false,
  });

  await node.signIn();

  return {
    node,
    did: node.did,
  };
}

// ── Session Error Detection ──────────────────────────────────────────

const SESSION_ERROR_PATTERN =
  /\b(session\s+expired|invalid\s+session|token\s+expired|expired\s+credentials?|unauthorized|unauthenticated|sign.?in\s*required)\b|\b401\b(?![\d-])/i;

function isSessionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return SESSION_ERROR_PATTERN.test(message);
}

// ── Session Refresh Wrapper ──────────────────────────────────────────

/**
 * Wraps an async function so that if it fails with a session-related error,
 * the node re-signs-in and the function is retried once.
 *
 * Use this around any TinyCloud KV/SQL operation that might fail due
 * to an expired session.
 */
export async function withSessionRefresh<T>(node: TinyCloudNode, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (isSessionError(err)) {
      // Re-authenticate and retry once
      await node.signIn();
      return fn();
    }

    throw err;
  }
}

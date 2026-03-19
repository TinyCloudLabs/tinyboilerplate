import { TinyCloudNode } from "@tinycloud/node-sdk";

// ── Configuration ────────────────────────────────────────────────────

export interface BackendIdentityConfig {
  /** Ethereum private key with 0x prefix */
  privateKey: string;
  /** TinyCloud node host */
  host?: string;
  /** KV key prefix for backend data */
  prefix?: string;
  /** Automatically create a space if one doesn't exist */
  autoCreateSpace?: boolean;
}

export interface BackendIdentity {
  node: TinyCloudNode;
  did: string;
}

// ── Create Backend Identity ──────────────────────────────────────────

/**
 * Initialize a TinyCloudNode instance with the given private key,
 * sign in, and return the node + its DID.
 *
 * This is the backend's own identity — used to store delegations
 * and access user data via delegated capabilities.
 */
export async function createBackendIdentity(
  config: BackendIdentityConfig,
): Promise<BackendIdentity> {
  const node = new TinyCloudNode({
    privateKey: config.privateKey,
    host: config.host ?? "https://node.tinycloud.xyz",
    prefix: config.prefix ?? "boilerplate-be",
    autoCreateSpace: config.autoCreateSpace ?? true,
  });

  await node.signIn();

  return {
    node,
    did: node.did,
  };
}

// ── Session Error Detection ──────────────────────────────────────────

const SESSION_MESSAGE_RE =
  /session.*(expired|invalid|not found)|(invalid|expired).*session|not signed in|authentication required|\b401\b.*(unauthorized|not authorized)/i;

/**
 * Determines whether an error represents a session/authentication failure
 * that can be resolved by re-signing in.
 *
 * Detection order:
 * 1. Structured `code` property (`AUTH_EXPIRED` or `AUTH_REQUIRED`)
 * 2. HTTP status property (`status` or `statusCode` equal to 401)
 * 3. Narrow regex match on the error message
 */
export function isSessionError(err: unknown): boolean {
  // 1. Check for SDK ServiceError code
  if (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as any).code === "string"
  ) {
    const code = (err as any).code as string;
    if (code === "AUTH_EXPIRED" || code === "AUTH_REQUIRED") return true;
  }

  // 2. Check for HTTP 401 status
  if (err != null && typeof err === "object") {
    const status = "status" in err ? (err as any).status : undefined;
    const statusCode = "statusCode" in err ? (err as any).statusCode : undefined;
    if (status === 401 || statusCode === 401) return true;
  }

  // 3. Fall back to narrow regex on error message
  const message = err instanceof Error ? err.message : String(err);
  return SESSION_MESSAGE_RE.test(message);
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

// ── Delegation ───────────────────────────────────────────────────────

export type DelegationStatus = "active" | "expired" | "none" | "stale";

export interface StoredDelegation {
  serialized: string;
  grantedAt: string;
  expiresAt: string;
  actions: string[];
  path: string;
  /** Hash of the backend permission policy this delegation was issued for. */
  policyHash?: string;
  /** Backend, worker, or agent DID this delegation was issued to. */
  delegateDid?: string;
  /** Full multi-resource grant metadata when available. */
  resources?: ServerInfoPermission[];
}

// ── Server Info ──────────────────────────────────────────────────────

/**
 * Permission entry shape used in {@link ServerInfo.permissions}. This is
 * deliberately kept as a plain object (no import from `@tinycloud/sdk-core`)
 * so the `core` package has no runtime TinyCloud deps — the frontend and
 * backend both massage this into a TinyCloud manifest `PermissionEntry`
 * when building or consuming the manifest.
 *
 * `service` uses the long form (e.g. `"tinycloud.kv"`) so the frontend
 * can turn these entries into a delegate manifest without translation.
 */
export interface ServerInfoPermission {
  service: string;
  space?: string;
  path: string;
  actions: string[];
  /** Skip the app-id prefix when resolving this manifest permission. */
  skipPrefix?: boolean;
  /** Optional user/agent-facing context for why the permission is needed. */
  description?: string;
}

/**
 * Shape of `/api/server-info`. The backend advertises its identity plus
 * the capabilities it needs the user to grant via a delegation. The
 * frontend composes this with the app manifest into a single signed
 * capability request, then materializes the delegation after sign-in.
 */
export interface ServerInfo {
  did: string;
  status: string;
  /**
   * Stable hash of the backend delegation policy. Required when this
   * server-info response advertises permissions for a delegation backend;
   * optional only for non-delegating endpoints.
   */
  policyHash?: string;
  /** Human-readable name for the permission modal. Optional. */
  name?: string;
  /**
   * Expiry override for the backend delegation as an ms-format duration
   * string (e.g. `"7d"`, `"1h"`). Optional — defaults to the manifest's
   * own expiry.
   */
  expiry?: string;
  /**
   * Permissions the backend needs the user to delegate to it. Always
   * present for backends that participate in delegation flows; omitted
   * (or empty array) for backends that operate without delegation.
   */
  permissions?: ServerInfoPermission[];
}

export type NonEmptyServerInfoPermissions = [ServerInfoPermission, ...ServerInfoPermission[]];

/**
 * Stricter `/api/server-info` contract for backends, workers, or agents that
 * participate in delegation. A delegating backend must publish a stable
 * `policyHash` and at least one requested permission so clients can detect
 * stale stored delegations after policy changes.
 */
export interface DelegatingServerInfo extends ServerInfo {
  policyHash: string;
  permissions: NonEmptyServerInfoPermissions;
}

// ── API Responses ────────────────────────────────────────────────────

export interface DelegationResponse {
  status: DelegationStatus;
  expiresAt: string | null;
}

export interface ApiError {
  error: string;
  message: string;
}

// ── Store Selection ──────────────────────────────────────────────────

export type StoreType = "kv" | "sql" | "duckdb";

// ── Constants ────────────────────────────────────────────────────────

/** Default delegation expiry: 1 year */
export const DEFAULT_DELEGATION_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

/** DelegatedAccess cache TTL: 50 minutes (under 1-hour sub-session cap) */
export const DELEGATION_CACHE_TTL_MS = 50 * 60 * 1000;

// ── Storage Full ─────────────────────────────────────────────────────
//
// Storage is an account-wide budget shared by every TinyCloud app. When it
// is full the node refuses writes that would grow storage; reads keep
// working. Apps detect the rejection by code, keep reads available, and word
// it with the copy below. Never say "quota", "Limit: 0", "network error", or
// "try again", and never name a space as the thing that is full.

/** Where the owner frees up space or changes plan. */
export const MANAGE_STORAGE_URL = "https://account.tinycloud.xyz/billing";

/**
 * `STORAGE_QUOTA_EXCEEDED`: storage is full (node HTTP 402).
 * `STORAGE_LIMIT_REACHED`: this write is larger than what is left (HTTP 413).
 */
export type StorageFullCode = "STORAGE_QUOTA_EXCEEDED" | "STORAGE_LIMIT_REACHED";

/** Canonical user-facing storage-full copy. */
export const STORAGE_FULL_COPY = {
  saveRejected:
    "Your TinyCloud storage is full, so this change was not saved. Reading still works. Free up space or upgrade your plan to save again.",
  saveTooLarge:
    "This change is larger than the TinyCloud storage you have left, so it was not saved. Reading still works. Free up space or upgrade your plan to save it.",
  bannerTitle: "Storage full: read-only.",
  bannerBody:
    "Your TinyCloud storage, shared by all your TinyCloud apps, is full. You can still view and copy your data. Saving changes is paused until you free up space or upgrade your plan.",
  manageLabel: "Manage storage",
} as const;

/** Body a backend returns when a write was refused because storage is full. */
export interface StorageFullApiError extends ApiError {
  error: StorageFullCode;
  manageUrl: string;
  /** True when part of the change was stored; `message` says which part. */
  partial?: boolean;
}

const STORAGE_FULL_TEXT =
  /storage quota exceeded|write exceeds remaining storage|storage is full|storage you have left/i;
const STORAGE_TOO_LARGE_TEXT = /write exceeds remaining storage|storage you have left/i;

type ErrorLink = { code?: unknown; error?: unknown; message?: unknown; cause?: unknown };

/**
 * Classify an error as a storage-full rejection. A typed code anywhere in the
 * chain (`code` from the SDK, `error` from an API body, following `cause` and
 * nested `error` objects) wins over text, because wrappers copy the node's
 * generic "Storage quota exceeded" sentence even for `STORAGE_LIMIT_REACHED`.
 * Only when no link carries a code does the node's text decide, for older SDKs
 * that report a SQL 402 as a network error.
 */
export function storageFullCode(error: unknown): StorageFullCode | null {
  const chain: Array<ErrorLink | string> = [];
  let current: unknown = error;
  while (
    chain.length < 8 &&
    (typeof current === "string" || (current && typeof current === "object"))
  ) {
    const link = current as ErrorLink | string;
    chain.push(link);
    if (typeof link === "string") break;
    current = link.cause ?? (link.error && typeof link.error === "object" ? link.error : undefined);
  }

  for (const link of chain) {
    if (typeof link === "string") continue;
    for (const value of [link.code, link.error]) {
      if (typeof value !== "string") continue;
      const upper = value.toUpperCase();
      if (upper === "STORAGE_QUOTA_EXCEEDED" || upper === "STORAGE_LIMIT_REACHED") return upper;
    }
  }
  for (const link of chain) {
    const text = typeof link === "string" ? link : link.message;
    if (typeof text !== "string") continue;
    if (STORAGE_TOO_LARGE_TEXT.test(text)) return "STORAGE_LIMIT_REACHED";
    if (STORAGE_FULL_TEXT.test(text)) return "STORAGE_QUOTA_EXCEEDED";
  }
  return null;
}

export function isStorageFullError(error: unknown): boolean {
  return storageFullCode(error) !== null;
}

/** The canonical "not saved" sentence for a storage rejection. */
export function storageSaveMessage(code: StorageFullCode): string {
  return code === "STORAGE_LIMIT_REACHED"
    ? STORAGE_FULL_COPY.saveTooLarge
    : STORAGE_FULL_COPY.saveRejected;
}

// ── Utilities ───────────────────────────────────────────────────────

/**
 * Derive the OpenKey API host from a frontend or API host.
 * "https://openkey.so" → "https://api.openkey.so"
 * "https://api.openkey.so" → "https://api.openkey.so" (no change)
 * "http://localhost:3000" → "http://localhost:3000" (no change)
 */
export function deriveApiHost(host: string): string {
  try {
    const url = new URL(host);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return host;
    }
    if (url.hostname.startsWith("api.")) {
      return host;
    }
    return `${url.protocol}//api.${url.host}`;
  } catch {
    return host;
  }
}

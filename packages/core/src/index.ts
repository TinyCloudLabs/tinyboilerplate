// ── ISO 8601 Branded Type ────────────────────────────────────────────

/** ISO 8601 date-time string (e.g. "2024-01-15T12:00:00.000Z") */
export type ISODateString = string & { readonly __brand: "ISODateString" };

/** Create an ISODateString from a Date (defaults to now). */
export function toISODateString(date: Date = new Date()): ISODateString {
  return date.toISOString() as ISODateString;
}

// ── Item (the abstract CRUD entity) ──────────────────────────────────

export interface Item {
  id: string;
  title: string;
  data?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CreateItemInput {
  title: string;
  data?: string;
}

export interface UpdateItemInput {
  title?: string;
  data?: string;
}

// ── Delegation ───────────────────────────────────────────────────────

export type DelegationStatus = "active" | "expired" | "none";

export interface DelegationInfo {
  status: DelegationStatus;
  expiresAt: ISODateString | null;
}

export interface StoredDelegation {
  serialized: string;
  grantedAt: ISODateString;
  expiresAt: ISODateString;
  actions: string[];
  path: string;
}

// ── Server Info ──────────────────────────────────────────────────────

export interface ServerInfo {
  did: string;
  status: string;
}

// ── API Responses ────────────────────────────────────────────────────

export interface ItemResponse {
  item: Item;
}

export interface ItemListResponse {
  items: Item[];
}

export interface DelegationResponse {
  status: DelegationStatus;
  expiresAt: ISODateString;
}

export interface ApiError {
  error: string;
  message: string;
}

// ── Store Selection ──────────────────────────────────────────────────

export type StoreType = "kv" | "sql";

// ── Constants ────────────────────────────────────────────────────────

/** Default TinyCloud KV actions for item CRUD */
export const DEFAULT_DELEGATION_ACTIONS = [
  "tinycloud.kv/get",
  "tinycloud.kv/put",
  "tinycloud.kv/del",
  "tinycloud.kv/list",
] as const;

/** Default delegation path scope (empty = full space access) */
export const DEFAULT_DELEGATION_PATH = "";

/** Default delegation expiry: 7 days */
export const DEFAULT_DELEGATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** DelegatedAccess cache TTL: 50 minutes (under 1-hour sub-session cap) */
export const DELEGATION_CACHE_TTL_MS = 50 * 60 * 1000;

/** Default fetch request timeout: 30 seconds */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** Default maximum entries in the DelegationCache */
export const DEFAULT_DELEGATION_CACHE_MAX_SIZE = 1000;

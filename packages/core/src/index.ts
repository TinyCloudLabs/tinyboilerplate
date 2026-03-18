// ── Logger Interface ─────────────────────────────────────────────────

/**
 * Pluggable logger interface. Matches the subset of console used by the SDK.
 * Compatible with console, pino, winston, bunyan, etc.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Default logger that delegates to console. */
export const consoleLogger: Logger = {
  debug(message, ...args) { console.debug(message, ...args); },
  info(message, ...args) { console.info(message, ...args); },
  warn(message, ...args) { console.warn(message, ...args); },
  error(message, ...args) { console.error(message, ...args); },
};

/** No-op logger that silences all output. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

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

// ── Pagination ──────────────────────────────────────────────────────

/**
 * Parameters for requesting a paginated list.
 * Supports both cursor-based and offset-based pagination.
 *
 * - Cursor-based: pass `cursor` (opaque string from a previous response).
 * - Offset-based: pass `offset` (zero-based index into the result set).
 * - `limit` controls page size in either mode (clamped to MAX_PAGE_LIMIT).
 */
export interface PaginationParams {
  /** Opaque cursor returned by a previous paginated response. */
  cursor?: string;
  /** Maximum number of items to return (default: DEFAULT_PAGE_LIMIT). */
  limit?: number;
  /** Zero-based offset for offset-based pagination. */
  offset?: number;
}

/**
 * Metadata returned alongside a paginated list of items.
 */
export interface PaginationMeta {
  /** Total number of items matching the query (omitted when unknown or expensive to compute). */
  total?: number;
  /** Opaque cursor to pass in the next request for cursor-based pagination. Absent on the last page. */
  cursor?: string;
  /** True when more items exist beyond the current page. */
  hasMore: boolean;
}

/**
 * Generic paginated response wrapper.
 *
 * @typeParam T - The type of each item in the list.
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
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

/** Default page size for paginated list responses */
export const DEFAULT_PAGE_LIMIT = 50;

/** Maximum allowed page size for paginated list responses */
export const MAX_PAGE_LIMIT = 200;

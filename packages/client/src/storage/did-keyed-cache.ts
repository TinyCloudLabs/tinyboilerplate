// ── DID-keyed SWR cache ───────────────────────────────────────────────────────
//
// Extracted from TinyChat's localStorage cache (frontend/src/lib/threadStore.ts:
// 539-556, 790-827) as a generic mechanism.
//
// WHY THIS EXISTS: a stale-while-revalidate cache lets the UI paint instantly
// from localStorage while a slow SQL read revalidates in the background. The
// cache key must identify the ACCOUNT. The obvious choice — `spaceId` — is a
// TRAP: `tcw.spaceId` is `undefined` on a RESTORED session (it is only populated
// after a fresh sign-in). Keying on spaceId silently disables the cache on every
// reload — exactly when instant paint matters most. The primary DID
// (`did:pkh:eip155:<chain>:<address>`) is present on BOTH fresh sign-in and
// restore, and gives correct per-account isolation, so it is the key. spaceId is
// only a last-resort fallback for the (unusual) case where a DID is absent.

/** Minimal structural view of a session — matches TinyCloudWeb's shape. */
export interface DidKeyedSession {
  did?: unknown;
  spaceId?: unknown;
}

/** The subset of the Web Storage API this cache uses (localStorage-compatible). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DidKeyedCacheOptions<T> {
  /** Key namespace, e.g. "tinytasks:index". Combined with the account id. */
  namespace: string;
  /**
   * Storage backend. Defaults to `globalThis.localStorage` when available; if no
   * storage is reachable the cache degrades to a no-op (reads return null).
   */
  storage?: KeyValueStorage | null;
  /** Serialize a value for storage. Defaults to `JSON.stringify`. */
  serialize?: (value: T) => string;
  /** Parse a stored string, or return null if it is unusable. Defaults to a safe JSON.parse. */
  deserialize?: (raw: string) => T | null;
}

export interface DidKeyedCache<T> {
  /** The storage key for a session, or null when no account id is derivable. */
  keyFor(session: DidKeyedSession): string | null;
  /** Read the cached value for a session, or null on miss / unusable payload. */
  read(session: DidKeyedSession): T | null;
  /** Write a value into the cache. No-op if no key is derivable or storage is absent. */
  write(session: DidKeyedSession, value: T): void;
  /** Remove the cached value for a session. */
  remove(session: DidKeyedSession): void;
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Derive the account id for cache keying. DID first (present on fresh AND
 * restored sessions), spaceId only as a fallback. This ordering is the entire
 * point of the helper — do not flip it.
 */
export function accountId(session: DidKeyedSession): string | null {
  const did = nonEmptyString(session.did);
  const space = nonEmptyString(session.spaceId);
  return did ?? space;
}

function resolveStorage(explicit?: KeyValueStorage | null): KeyValueStorage | null {
  if (explicit !== undefined) return explicit;
  try {
    const ls = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    return ls ?? null;
  } catch {
    // Accessing localStorage can throw (sandboxed iframes, disabled storage).
    return null;
  }
}

export function createDidKeyedCache<T>(options: DidKeyedCacheOptions<T>): DidKeyedCache<T> {
  const storage = resolveStorage(options.storage);
  const serialize = options.serialize ?? ((v: T) => JSON.stringify(v));
  const deserialize =
    options.deserialize ??
    ((raw: string): T | null => {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    });

  function keyFor(session: DidKeyedSession): string | null {
    const id = accountId(session);
    return id ? `${options.namespace}:${id}` : null;
  }

  return {
    keyFor,
    read(session) {
      if (!storage) return null;
      const key = keyFor(session);
      if (!key) return null;
      try {
        const raw = storage.getItem(key);
        return raw == null ? null : deserialize(raw);
      } catch {
        return null;
      }
    },
    write(session, value) {
      if (!storage) return;
      const key = keyFor(session);
      if (!key) return;
      try {
        storage.setItem(key, serialize(value));
      } catch {
        // Storage full / disabled — the cache is optional, never fail a write.
      }
    },
    remove(session) {
      if (!storage) return;
      const key = keyFor(session);
      if (!key) return;
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

import type { StoredTokens } from "./tokens.js";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Interface for persisting tokens across page reloads.
 * Implement this to wire your own storage backend (e.g., IndexedDB, AsyncStorage).
 */
export interface TokenPersistence {
  /** Save tokens to persistent storage. */
  save(tokens: StoredTokens): void;
  /** Load tokens from persistent storage, or null if none exist. */
  load(): StoredTokens | null;
  /** Clear persisted tokens. */
  clear(): void;
}

// ── Default storage key ──────────────────────────────────────────────

const DEFAULT_STORAGE_KEY = "tinyboilerplate:tokens";

// ── Built-in implementations ─────────────────────────────────────────

/**
 * Create a Web Storage-backed persistence implementation.
 * Handles errors gracefully (e.g., private browsing, quota exceeded).
 */
function createWebStoragePersistence(storage: Storage, key: string): TokenPersistence {
  return {
    save(tokens: StoredTokens): void {
      try {
        storage.setItem(key, JSON.stringify(tokens));
      } catch (err) {
        console.warn("[TokenPersistence] Failed to save tokens:", err);
      }
    },

    load(): StoredTokens | null {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;

        const parsed = JSON.parse(raw);

        // Validate the shape minimally
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof parsed.accessToken === "string" &&
          typeof parsed.expiresAt === "number"
        ) {
          return parsed as StoredTokens;
        }

        // Invalid shape — clear corrupted data
        storage.removeItem(key);
        return null;
      } catch (err) {
        console.warn("[TokenPersistence] Failed to load tokens:", err);
        return null;
      }
    },

    clear(): void {
      try {
        storage.removeItem(key);
      } catch (err) {
        console.warn("[TokenPersistence] Failed to clear tokens:", err);
      }
    },
  };
}

/**
 * Persist tokens to `localStorage`. Survives page reloads and browser restarts.
 *
 * @param key - Storage key (default: `"tinyboilerplate:tokens"`)
 */
export function createLocalStoragePersistence(key: string = DEFAULT_STORAGE_KEY): TokenPersistence {
  return createWebStoragePersistence(localStorage, key);
}

/**
 * Persist tokens to `sessionStorage`. Survives page reloads within the same tab,
 * but cleared when the tab is closed.
 *
 * @param key - Storage key (default: `"tinyboilerplate:tokens"`)
 */
export function createSessionStoragePersistence(
  key: string = DEFAULT_STORAGE_KEY,
): TokenPersistence {
  return createWebStoragePersistence(sessionStorage, key);
}

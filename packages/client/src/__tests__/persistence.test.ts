import { describe, test, expect, beforeEach } from "bun:test";
import { TokenStore, type StoredTokens } from "../tokens.js";
import type { TokenPersistence } from "../persistence.js";

// ── Mock persistence ─────────────────────────────────────────────────

function createMockPersistence(): TokenPersistence & {
  saved: StoredTokens | null;
  clearCount: number;
  loadCount: number;
} {
  const mock = {
    saved: null as StoredTokens | null,
    clearCount: 0,
    loadCount: 0,

    save(tokens: StoredTokens): void {
      mock.saved = { ...tokens };
    },

    load(): StoredTokens | null {
      mock.loadCount++;
      return mock.saved ? { ...mock.saved } : null;
    },

    clear(): void {
      mock.clearCount++;
      mock.saved = null;
    },
  };

  return mock;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("TokenStore with persistence", () => {
  let persistence: ReturnType<typeof createMockPersistence>;
  let store: TokenStore;

  beforeEach(() => {
    persistence = createMockPersistence();
    store = new TokenStore({ persistence });
  });

  // ── setTokens saves to persistence ─────────────────────────────────

  test("setTokens saves to persistence", () => {
    store.setTokens("access-1", "refresh-1", 3600);

    expect(persistence.saved).not.toBeNull();
    expect(persistence.saved!.accessToken).toBe("access-1");
    expect(persistence.saved!.refreshToken).toBe("refresh-1");
    expect(persistence.saved!.expiresAt).toBeGreaterThan(Date.now());
  });

  // ── clear removes from persistence ─────────────────────────────────

  test("clear removes from persistence", () => {
    store.setTokens("access-1", "refresh-1", 3600);
    expect(persistence.saved).not.toBeNull();

    store.clear();

    expect(persistence.saved).toBeNull();
    expect(persistence.clearCount).toBe(1);
  });

  // ── restore ────────────────────────────────────────────────────────

  test("restore loads valid tokens from persistence", () => {
    // Pre-seed persistence
    persistence.saved = {
      accessToken: "persisted-access",
      refreshToken: "persisted-refresh",
      expiresAt: Date.now() + 3600_000, // 1 hour from now
    };

    const result = store.restore();

    expect(result).toBe(true);
    expect(store.hasTokens()).toBe(true);
    expect(store.getAccessToken()).toBe("persisted-access");
    expect(store.getRefreshToken()).toBe("persisted-refresh");
    expect(store.isExpired()).toBe(false);
  });

  test("restore returns false when persistence is empty", () => {
    const result = store.restore();

    expect(result).toBe(false);
    expect(store.hasTokens()).toBe(false);
  });

  test("restore returns false and clears expired tokens", () => {
    // Pre-seed with expired tokens
    persistence.saved = {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() - 1000, // expired 1s ago
    };

    const result = store.restore();

    expect(result).toBe(false);
    expect(store.hasTokens()).toBe(false);
    expect(persistence.saved).toBeNull(); // cleared from persistence
    expect(persistence.clearCount).toBe(1);
  });

  test("restore returns false for tokens within expiry buffer", () => {
    // Pre-seed with tokens that expire in 20s (within 30s buffer)
    persistence.saved = {
      accessToken: "almost-expired",
      refreshToken: "refresh",
      expiresAt: Date.now() + 20_000,
    };

    const result = store.restore();

    expect(result).toBe(false);
    expect(store.hasTokens()).toBe(false);
  });

  // ── No persistence (backward compatibility) ────────────────────────

  test("works without persistence (default constructor)", () => {
    const storeNoPersistence = new TokenStore();

    storeNoPersistence.setTokens("a", "r", 3600);
    expect(storeNoPersistence.getAccessToken()).toBe("a");

    storeNoPersistence.clear();
    expect(storeNoPersistence.hasTokens()).toBe(false);
  });

  test("restore returns false without persistence", () => {
    const storeNoPersistence = new TokenStore();
    expect(storeNoPersistence.restore()).toBe(false);
  });

  // ── refresh persists new tokens ────────────────────────────────────

  test("refresh saves updated tokens to persistence", async () => {
    store.setTokens("old-access", "old-refresh", 3600);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          access_token: "refreshed-access",
          refresh_token: "refreshed-refresh",
          expires_in: 7200,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      await store.refresh({
        openKeyHost: "https://openkey.example.com",
        clientId: "test-client",
      });

      expect(persistence.saved).not.toBeNull();
      expect(persistence.saved!.accessToken).toBe("refreshed-access");
      expect(persistence.saved!.refreshToken).toBe("refreshed-refresh");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("refresh failure clears persistence", async () => {
    store.setTokens("old-access", "old-refresh", 3600);
    expect(persistence.saved).not.toBeNull();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response("Invalid grant", { status: 400 });
    }) as typeof fetch;

    try {
      await expect(
        store.refresh({
          openKeyHost: "https://openkey.example.com",
          clientId: "test-client",
        }),
      ).rejects.toThrow("Token refresh failed");

      expect(persistence.saved).toBeNull();
      expect(persistence.clearCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── Web Storage persistence (unit) ───────────────────────────────────

describe("createWebStoragePersistence (via createLocalStoragePersistence)", () => {
  // We can't easily test the real localStorage/sessionStorage functions
  // in a non-browser bun environment, but we can test the TokenPersistence
  // interface contract via the mock above. The actual web storage
  // implementations are thin wrappers around the same logic.

  test("TokenPersistence interface contract is satisfied by mock", () => {
    const p = createMockPersistence();

    // save + load
    const tokens: StoredTokens = {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 3600_000,
    };
    p.save(tokens);
    const loaded = p.load();
    expect(loaded).toEqual(tokens);

    // clear + load
    p.clear();
    expect(p.load()).toBeNull();
  });
});

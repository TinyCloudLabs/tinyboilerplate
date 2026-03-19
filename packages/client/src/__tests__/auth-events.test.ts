import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { TokenStore, type TokenRefreshConfig } from "../tokens.js";
import type { AuthEvent } from "../auth-events.js";
import type { TokenPersistence } from "../persistence.js";

// ── Helpers ──────────────────────────────────────────────────────────

function createMockPersistence(): TokenPersistence {
  let stored: ReturnType<TokenPersistence["load"]> = null;
  return {
    save(tokens) {
      stored = tokens;
    },
    load() {
      return stored;
    },
    clear() {
      stored = null;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("TokenStore auth events", () => {
  let store: TokenStore;
  let events: AuthEvent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    store = new TokenStore();
    events = [];
    unsubscribe = store.onAuthStateChange((event) => events.push(event));
  });

  // ── setTokens ────────────────────────────────────────────────────

  test("setTokens emits tokens_set", () => {
    store.setTokens("access", "refresh", 3600);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "tokens_set" });
  });

  // ── clear ────────────────────────────────────────────────────────

  test("clear emits tokens_cleared", () => {
    store.setTokens("access", "refresh", 3600);
    events.length = 0; // reset

    store.clear();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "tokens_cleared" });
  });

  // ── restore ──────────────────────────────────────────────────────

  test("restore emits tokens_restored when tokens exist", () => {
    const persistence = createMockPersistence();
    const storeWithPersistence = new TokenStore({ persistence });

    // Pre-populate persistence with valid tokens
    storeWithPersistence.setTokens("access", "refresh", 3600);

    // New store reads from persistence
    const freshStore = new TokenStore({ persistence });
    const freshEvents: AuthEvent[] = [];
    freshStore.onAuthStateChange((e) => freshEvents.push(e));

    const restored = freshStore.restore();

    expect(restored).toBe(true);
    expect(freshEvents).toHaveLength(1);
    expect(freshEvents[0]).toEqual({ type: "tokens_restored" });
  });

  test("restore does NOT emit when no tokens in persistence", () => {
    const persistence = createMockPersistence();
    const storeWithPersistence = new TokenStore({ persistence });
    const freshEvents: AuthEvent[] = [];
    storeWithPersistence.onAuthStateChange((e) => freshEvents.push(e));

    const restored = storeWithPersistence.restore();

    expect(restored).toBe(false);
    expect(freshEvents).toHaveLength(0);
  });

  test("restore does NOT emit when no persistence configured", () => {
    // store has no persistence (default)
    events.length = 0;
    const restored = store.restore();

    expect(restored).toBe(false);
    expect(events).toHaveLength(0);
  });

  // ── refresh failure ──────────────────────────────────────────────

  describe("refresh failure events", () => {
    const refreshConfig: TokenRefreshConfig = {
      openKeyHost: "https://openkey.example.com",
      clientId: "test-client-id",
    };

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("refresh failure emits refresh_failed then tokens_cleared", async () => {
      store.setTokens("access", "refresh", 3600);
      events.length = 0;

      globalThis.fetch = (async () => {
        return new Response("Invalid grant", { status: 400 });
      }) as typeof fetch;

      await expect(store.refresh(refreshConfig)).rejects.toThrow("Token refresh failed");

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("refresh_failed");
      expect((events[0] as { type: "refresh_failed"; error: Error }).error.message).toContain(
        "Token refresh failed",
      );
      expect(events[1]).toEqual({ type: "tokens_cleared" });
    });

    test("refresh success emits tokens_set", async () => {
      store.setTokens("old-access", "old-refresh", 3600);
      events.length = 0;

      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 7200,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      await store.refresh(refreshConfig);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "tokens_set" });
    });
  });

  // ── unsubscribe ──────────────────────────────────────────────────

  test("unsubscribe stops events", () => {
    store.setTokens("access", "refresh", 3600);
    expect(events).toHaveLength(1);

    unsubscribe();
    store.setTokens("access2", "refresh2", 3600);

    // Still only the one event from before unsubscribe
    expect(events).toHaveLength(1);
  });

  // ── multiple listeners ───────────────────────────────────────────

  test("multiple listeners all receive events", () => {
    const events2: AuthEvent[] = [];
    store.onAuthStateChange((e) => events2.push(e));

    store.setTokens("access", "refresh", 3600);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "tokens_set" });
    expect(events2).toHaveLength(1);
    expect(events2[0]).toEqual({ type: "tokens_set" });
  });

  // ── listener error isolation ─────────────────────────────────────

  test("listener errors do not break other listeners", () => {
    const events2: AuthEvent[] = [];

    // Add a listener that throws
    store.onAuthStateChange(() => {
      throw new Error("Bad listener");
    });

    // Add a well-behaved listener
    store.onAuthStateChange((e) => events2.push(e));

    store.setTokens("access", "refresh", 3600);

    // Original listener still received the event
    expect(events).toHaveLength(1);
    // Listener added after the throwing one also received it
    expect(events2).toHaveLength(1);
  });

  // ── event ordering in full lifecycle ─────────────────────────────

  test("events fire in correct order during sign-in then sign-out", () => {
    store.setTokens("access", "refresh", 3600);
    store.clear();

    expect(events.map((e) => e.type)).toEqual(["tokens_set", "tokens_cleared"]);
  });

  // ── no events without listeners ──────────────────────────────────

  test("no errors when emitting with no listeners", () => {
    // Remove our default listener
    unsubscribe();

    // These should not throw
    expect(() => store.setTokens("a", "r", 3600)).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });
});

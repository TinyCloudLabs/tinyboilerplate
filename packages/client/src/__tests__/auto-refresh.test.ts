import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TokenStore, type TokenRefreshConfig } from "../tokens.js";

// ── Helpers ─────────────────────────────────────────────────────────

const refreshConfig: TokenRefreshConfig = {
  openKeyHost: "https://openkey.example.com",
  clientId: "test-client-id",
};

/** Install a mock fetch that returns new tokens on every call. */
function mockFetchSuccess(): { callCount: () => number } {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        access_token: `access-${calls}`,
        refresh_token: `refresh-${calls}`,
        expires_in: 3600,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return { callCount: () => calls };
}

/** Install a mock fetch that always fails. */
function mockFetchFailure(): void {
  globalThis.fetch = (async () => {
    return new Response("Invalid grant", { status: 400 });
  }) as typeof fetch;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("TokenStore auto-refresh", () => {
  let store: TokenStore;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    store = new TokenStore();
  });

  afterEach(() => {
    // Always clean up timers and fetch mock
    store.stopAutoRefresh();
    globalThis.fetch = originalFetch;
  });

  // ── Timer lifecycle ──────────────────────────────────────────────

  test("startAutoRefresh starts the timer, stopAutoRefresh stops it", () => {
    store.setTokens("a", "r", 3600);

    expect(store.isAutoRefreshRunning()).toBe(false);

    store.startAutoRefresh(refreshConfig);
    expect(store.isAutoRefreshRunning()).toBe(true);

    store.stopAutoRefresh();
    expect(store.isAutoRefreshRunning()).toBe(false);
  });

  test("clear() stops a running auto-refresh timer", () => {
    store.setTokens("a", "r", 3600);
    store.startAutoRefresh(refreshConfig);

    expect(store.isAutoRefreshRunning()).toBe(true);
    store.clear();
    expect(store.isAutoRefreshRunning()).toBe(false);
  });

  test("startAutoRefresh replaces an existing timer", () => {
    store.setTokens("a", "r", 3600);
    store.startAutoRefresh(refreshConfig, { intervalMs: 10_000 });
    expect(store.isAutoRefreshRunning()).toBe(true);

    // Starting again should not leak the previous timer
    store.startAutoRefresh(refreshConfig, { intervalMs: 20_000 });
    expect(store.isAutoRefreshRunning()).toBe(true);

    store.stopAutoRefresh();
    expect(store.isAutoRefreshRunning()).toBe(false);
  });

  // ── Proactive refresh triggers ────────────────────────────────────

  test("proactive refresh triggers when token is near expiry", async () => {
    const tracker = mockFetchSuccess();

    // Token expires in 10 seconds — well within the default 5-min threshold
    store.setTokens("a", "r", 10);

    // Use a very short interval so it fires quickly
    store.startAutoRefresh(refreshConfig, { intervalMs: 50 });

    // Wait for at least one tick
    await new Promise((r) => setTimeout(r, 200));

    expect(tracker.callCount()).toBeGreaterThanOrEqual(1);
    // Token should have been refreshed — new access token
    expect(store.getAccessToken()).toMatch(/^access-/);
  });

  test("does not refresh when token has plenty of time left", async () => {
    const tracker = mockFetchSuccess();

    // Token expires in 1 hour — not near any threshold
    store.setTokens("a", "r", 3600);

    store.startAutoRefresh(refreshConfig, {
      intervalMs: 50,
      refreshAtLifetimeFraction: 0.8,
      minTimeBeforeExpiryMs: 300_000,
    });

    await new Promise((r) => setTimeout(r, 200));

    // Should NOT have called fetch since the token is fresh
    expect(tracker.callCount()).toBe(0);
    expect(store.getAccessToken()).toBe("a");
  });

  // ── Concurrent refresh debounce ───────────────────────────────────

  test("concurrent refresh calls are debounced", async () => {
    let resolveRefresh!: () => void;
    let calls = 0;

    // Slow fetch that we control
    globalThis.fetch = (async () => {
      calls++;
      await new Promise<void>((r) => {
        resolveRefresh = r;
      });
      return new Response(
        JSON.stringify({
          access_token: "new",
          refresh_token: "new-r",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    // Token about to expire
    store.setTokens("a", "r", 5);

    store.startAutoRefresh(refreshConfig, { intervalMs: 30 });

    // Wait for multiple ticks — only one fetch should start
    await new Promise((r) => setTimeout(r, 150));

    expect(calls).toBe(1);

    // Let the in-flight refresh complete
    resolveRefresh();
    await new Promise((r) => setTimeout(r, 50));
  });

  // ── Failure stops the timer ───────────────────────────────────────

  test("refresh failure stops the auto-refresh timer", async () => {
    mockFetchFailure();

    // Token about to expire
    store.setTokens("a", "r", 5);

    store.startAutoRefresh(refreshConfig, { intervalMs: 50 });

    // Wait for the failure to propagate
    await new Promise((r) => setTimeout(r, 200));

    // clear() is called by refresh() on failure, which stops the timer
    expect(store.isAutoRefreshRunning()).toBe(false);
    expect(store.hasTokens()).toBe(false);
  });

  // ── No refresh token → skip ───────────────────────────────────────

  test("skips refresh when there is no refresh token", async () => {
    const tracker = mockFetchSuccess();

    // No refresh token
    store.setTokens("a", null, 10);

    store.startAutoRefresh(refreshConfig, { intervalMs: 50 });

    await new Promise((r) => setTimeout(r, 200));

    // Should never have called fetch
    expect(tracker.callCount()).toBe(0);
  });

  // ── setTokens tracks lifetime ─────────────────────────────────────

  test("setTokens records tokenLifetimeMs for fraction-based refresh", () => {
    // This is an indirect test — we verify that a token with 80%+ elapsed
    // triggers refresh even when remaining time is above minTimeBeforeExpiryMs.
    const tracker = mockFetchSuccess();

    // Lifetime = 1000s, but we cannot easily mock Date.now.
    // Instead, test that a 3600s token does NOT trigger (tested above).
    // Here, confirm that a short-lived token triggers because of the fraction.
    //
    // 60s lifetime, fraction 0.8 → trigger after 48s elapsed (12s remaining).
    // minTimeBeforeExpiryMs set very low so only fraction matters.
    store.setTokens("a", "r", 60);

    // Fake the expiresAt to simulate 50s elapsed (10s remaining)
    // Access private state for this edge-case test:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = store as any;
    s.tokens.expiresAt = Date.now() + 10_000; // 10s remaining of 60s lifetime

    store.startAutoRefresh(refreshConfig, {
      intervalMs: 50,
      refreshAtLifetimeFraction: 0.8,
      minTimeBeforeExpiryMs: 1_000, // very low
    });

    // Wait for tick
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(tracker.callCount()).toBeGreaterThanOrEqual(1);
        resolve();
      }, 200);
    });
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { DelegationMonitor } from "../delegation-monitor.js";

describe("DelegationMonitor", () => {
  let monitor: DelegationMonitor;

  beforeEach(() => {
    monitor = new DelegationMonitor({ checkIntervalMs: 50, warningThresholdMs: 500 });
  });

  afterEach(() => {
    monitor.stop();
  });

  // ── Track / Stop lifecycle ──────────────────────────────────────────

  test("isTracking returns false initially", () => {
    expect(monitor.isTracking()).toBe(false);
  });

  test("isTracking returns true after track()", () => {
    monitor.track(Date.now() + 60_000);
    expect(monitor.isTracking()).toBe(true);
  });

  test("isTracking returns false after stop()", () => {
    monitor.track(Date.now() + 60_000);
    monitor.stop();
    expect(monitor.isTracking()).toBe(false);
  });

  test("track() stops previous session", () => {
    const events: string[] = [];
    monitor.onExpiring(() => events.push("expiring"));

    // Track something far away
    monitor.track(Date.now() + 60_000);

    // Re-track something within threshold — should fire expiring for new session
    monitor.track(Date.now() + 200);
    expect(events).toContain("expiring");
  });

  // ── ISO string and timestamp input ──────────────────────────────────

  test("accepts ISO date string", () => {
    const futureDate = new Date(Date.now() + 30_000).toISOString();
    monitor.track(futureDate);
    expect(monitor.isTracking()).toBe(true);
    const remaining = monitor.getTimeRemaining();
    expect(remaining).not.toBeNull();
    expect(remaining!).toBeGreaterThan(0);
    expect(remaining!).toBeLessThanOrEqual(30_000);
  });

  test("accepts Unix timestamp in milliseconds", () => {
    monitor.track(Date.now() + 30_000);
    expect(monitor.isTracking()).toBe(true);
    const remaining = monitor.getTimeRemaining();
    expect(remaining).not.toBeNull();
    expect(remaining!).toBeGreaterThan(0);
    expect(remaining!).toBeLessThanOrEqual(30_000);
  });

  // ── getTimeRemaining ────────────────────────────────────────────────

  test("getTimeRemaining returns null when not tracking", () => {
    expect(monitor.getTimeRemaining()).toBeNull();
  });

  test("getTimeRemaining returns ms until expiry", () => {
    monitor.track(Date.now() + 10_000);
    const remaining = monitor.getTimeRemaining();
    expect(remaining).not.toBeNull();
    // Allow small tolerance for execution time
    expect(remaining!).toBeGreaterThan(9_900);
    expect(remaining!).toBeLessThanOrEqual(10_000);
  });

  test("getTimeRemaining returns 0 when expired", () => {
    monitor.track(Date.now() - 1000);
    expect(monitor.getTimeRemaining()).toBe(0);
  });

  // ── Expiring event ──────────────────────────────────────────────────

  test("expiring event fires when within threshold", async () => {
    const events: number[] = [];
    monitor.onExpiring((remaining) => events.push(remaining));

    // Track expiry 200ms in the future (within 500ms threshold)
    monitor.track(Date.now() + 200);

    // Should fire immediately on track since already within threshold
    expect(events.length).toBe(1);
    expect(events[0]).toBeLessThanOrEqual(200);
  });

  test("expiring event does not fire when outside threshold", () => {
    const events: number[] = [];
    monitor.onExpiring((remaining) => events.push(remaining));

    // Track expiry 60s in the future (outside 500ms threshold)
    monitor.track(Date.now() + 60_000);

    expect(events.length).toBe(0);
  });

  test("expiring event fires at most once per track session", async () => {
    const events: number[] = [];
    monitor.onExpiring((remaining) => events.push(remaining));

    // Track expiry 100ms in the future (within 500ms threshold)
    monitor.track(Date.now() + 100);

    // Wait for a few check cycles
    await sleep(200);

    // Should have fired exactly once (even though expired event may also fire)
    expect(events.length).toBe(1);
  });

  // ── Expired event ──────────────────────────────────────────────────

  test("expired event fires after expiry", async () => {
    const events: string[] = [];
    monitor.onExpired(() => events.push("expired"));

    // Track expiry 80ms in the future
    monitor.track(Date.now() + 80);

    // Wait for expiry + check
    await sleep(200);

    expect(events).toContain("expired");
  });

  test("expired event fires immediately for already-expired delegation", () => {
    const events: string[] = [];
    monitor.onExpired(() => events.push("expired"));

    // Already expired
    monitor.track(Date.now() - 1000);

    expect(events).toEqual(["expired"]);
  });

  test("expired event fires at most once per track session", async () => {
    const events: string[] = [];
    monitor.onExpired(() => events.push("expired"));

    monitor.track(Date.now() - 1000);

    await sleep(200);

    expect(events).toEqual(["expired"]);
  });

  // ── Events fire only once ─────────────────────────────────────────

  test("events fire only once across check cycles", async () => {
    const expiring: number[] = [];
    const expired: string[] = [];
    monitor.onExpiring((r) => expiring.push(r));
    monitor.onExpired(() => expired.push("expired"));

    // Already expired — both should fire exactly once
    monitor.track(Date.now() - 1000);

    await sleep(200);

    expect(expiring.length).toBe(1);
    expect(expired.length).toBe(1);
  });

  // ── Unsubscribe ────────────────────────────────────────────────────

  test("unsubscribe prevents future callbacks", () => {
    const events: string[] = [];
    const unsub = monitor.onExpired(() => events.push("expired"));

    unsub();

    monitor.track(Date.now() - 1000);
    expect(events).toEqual([]);
  });

  test("unsubscribe for expiring prevents callback", () => {
    const events: number[] = [];
    const unsub = monitor.onExpiring((r) => events.push(r));

    unsub();

    monitor.track(Date.now() + 100); // within threshold
    expect(events).toEqual([]);
  });

  // ── Multiple listeners ─────────────────────────────────────────────

  test("multiple expiring listeners all fire", () => {
    const a: number[] = [];
    const b: number[] = [];
    monitor.onExpiring((r) => a.push(r));
    monitor.onExpiring((r) => b.push(r));

    monitor.track(Date.now() + 100); // within 500ms threshold

    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  test("multiple expired listeners all fire", () => {
    const a: string[] = [];
    const b: string[] = [];
    monitor.onExpired(() => a.push("a"));
    monitor.onExpired(() => b.push("b"));

    monitor.track(Date.now() - 1000);

    expect(a).toEqual(["a"]);
    expect(b).toEqual(["b"]);
  });

  test("one bad listener does not break others", () => {
    const events: string[] = [];
    monitor.onExpired(() => {
      throw new Error("boom");
    });
    monitor.onExpired(() => events.push("ok"));

    monitor.track(Date.now() - 1000);

    expect(events).toEqual(["ok"]);
  });

  // ── Auto-stop after expired ─────────────────────────────────────────

  test("auto-stops timer after expired fires", async () => {
    const expired: string[] = [];
    monitor.onExpired(() => expired.push("expired"));

    monitor.track(Date.now() - 1000);

    // Expired fires immediately, timer should be cleared
    // getTimeRemaining still returns 0 since expiresAt is preserved (not reset by stopTimer)
    // but the interval is cleared so no further checks happen
    expect(expired).toEqual(["expired"]);

    // Wait and verify no additional fires
    await sleep(200);
    expect(expired).toEqual(["expired"]);
  });

  test("stop clears tracking state after auto-stop", () => {
    monitor.onExpired(() => {});

    monitor.track(Date.now() - 1000);

    // Call stop() explicitly to clean up fully
    monitor.stop();
    expect(monitor.isTracking()).toBe(false);
    expect(monitor.getTimeRemaining()).toBeNull();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

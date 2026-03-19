// ── Delegation Expiry Monitor ───────────────────────────────────────

/** Callback invoked when delegation is approaching expiry. */
export type ExpiringCallback = (remainingMs: number) => void;

/** Callback invoked when delegation has expired. */
export type ExpiredCallback = () => void;

/** Function to unsubscribe a previously registered listener. */
export type MonitorUnsubscribe = () => void;

export interface DelegationMonitorOptions {
  /** How often to check expiry, in milliseconds. Default: 60_000 (1 min). */
  checkIntervalMs?: number;
  /** Fire `onExpiring` when remaining time is within this threshold. Default: 86_400_000 (24h). */
  warningThresholdMs?: number;
}

// ── Monitor ─────────────────────────────────────────────────────────

/**
 * Monitors a delegation's expiry and fires callbacks when the delegation
 * is approaching expiry or has expired.
 *
 * Opt-in: nothing runs until `track()` is called.
 *
 * ```ts
 * const monitor = new DelegationMonitor();
 * monitor.onExpiring((remaining) => console.log(`Expiring in ${remaining}ms`));
 * monitor.onExpired(() => console.log("Expired!"));
 * monitor.track("2026-04-01T00:00:00Z");
 * ```
 */
export class DelegationMonitor {
  private readonly checkIntervalMs: number;
  private readonly warningThresholdMs: number;

  private expiresAt: number | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;

  private expiringFired = false;
  private expiredFired = false;

  private readonly expiringListeners = new Set<ExpiringCallback>();
  private readonly expiredListeners = new Set<ExpiredCallback>();

  constructor(options?: DelegationMonitorOptions) {
    this.checkIntervalMs = options?.checkIntervalMs ?? 60_000;
    this.warningThresholdMs = options?.warningThresholdMs ?? 24 * 60 * 60 * 1000;
  }

  // ── Subscription ────────────────────────────────────────────────────

  /**
   * Register a callback that fires when the delegation is within the
   * warning threshold of expiry. The callback receives the remaining
   * milliseconds. Fires at most once per `track()` session.
   *
   * Returns an unsubscribe function.
   */
  onExpiring(callback: ExpiringCallback): MonitorUnsubscribe {
    this.expiringListeners.add(callback);
    return () => {
      this.expiringListeners.delete(callback);
    };
  }

  /**
   * Register a callback that fires when the delegation has expired.
   * Fires at most once per `track()` session; the monitor auto-stops
   * after this event.
   *
   * Returns an unsubscribe function.
   */
  onExpired(callback: ExpiredCallback): MonitorUnsubscribe {
    this.expiredListeners.add(callback);
    return () => {
      this.expiredListeners.delete(callback);
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Start monitoring a delegation expiry.
   *
   * @param expiresAt — ISO 8601 date string or Unix timestamp in milliseconds.
   *
   * If already tracking, the previous session is stopped first.
   */
  track(expiresAt: string | number): void {
    // Stop any previous session
    this.stop();

    this.expiresAt = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : expiresAt;

    this.expiringFired = false;
    this.expiredFired = false;

    // Run an immediate check, then start the interval
    this.check();

    // Only start interval if we haven't already expired on the first check
    if (!this.expiredFired) {
      this.timerId = setInterval(() => this.check(), this.checkIntervalMs);
    }
  }

  /** Stop monitoring and clear the timer. */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.expiresAt = null;
    this.expiringFired = false;
    this.expiredFired = false;
  }

  // ── Query ───────────────────────────────────────────────────────────

  /**
   * Milliseconds remaining until expiry.
   * Returns 0 if already expired, null if not tracking.
   */
  getTimeRemaining(): number | null {
    if (this.expiresAt === null) return null;
    return Math.max(0, this.expiresAt - Date.now());
  }

  /** Whether the monitor is actively tracking a delegation. */
  isTracking(): boolean {
    return this.expiresAt !== null;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private check(): void {
    if (this.expiresAt === null) return;

    const remaining = this.expiresAt - Date.now();

    // Expired
    if (remaining <= 0) {
      if (!this.expiredFired) {
        this.expiredFired = true;

        // Also fire expiring if it hasn't fired yet
        if (!this.expiringFired) {
          this.expiringFired = true;
          this.emitExpiring(0);
        }

        this.emitExpired();
        // Auto-stop after expired
        this.stopTimer();
      }
      return;
    }

    // Within warning threshold
    if (remaining <= this.warningThresholdMs && !this.expiringFired) {
      this.expiringFired = true;
      this.emitExpiring(remaining);
    }
  }

  /** Stop the interval timer without resetting tracking state. */
  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /** Emit to all expiring listeners. Swallows listener errors. */
  private emitExpiring(remainingMs: number): void {
    for (const listener of this.expiringListeners) {
      try {
        listener(remainingMs);
      } catch {
        // Swallow listener errors — one bad listener must not break the monitor.
      }
    }
  }

  /** Emit to all expired listeners. Swallows listener errors. */
  private emitExpired(): void {
    for (const listener of this.expiredListeners) {
      try {
        listener();
      } catch {
        // Swallow listener errors — one bad listener must not break the monitor.
      }
    }
  }
}

// ── Schema ensurer (per-key memoized, shared in-flight) ──────────────────────
//
// Extracted from TinyChat's `ensureSchema` (frontend/src/lib/threadStore.ts:159-205)
// as a generic, dependency-free mechanism.
//
// WHY THIS EXISTS: a browser-direct app boots several storage helpers roughly
// simultaneously (list / get / read-settings all fire on mount), and the node
// degrades badly under parallel invokes — the concrete form of the "fetch
// sequentially" lesson. Without coordination, every first-caller issues its own
// schema-creation batch (~2s signed round-trip), multiplying boot traffic. This
// ensurer guarantees the underlying work runs AT MOST ONCE per key, and that
// concurrent first-callers SHARE the single in-flight promise instead of each
// launching their own.
//
// KEYING: the key is derived by the caller (typically the session's primary DID,
// falling back to spaceId). Preferring the DID matters because spaceId is
// `undefined` on a restored session — see did-keyed-cache.ts for the same rule.
//
// REJECTION SEMANTICS (deliberate — tested in schema-ensurer.test.ts):
//   A failed run is NOT memoized as ready, and its in-flight entry is cleared, so
//   a LATER call re-attempts the work. A transient failure (offline, 5xx, an
//   auth blip) must be recoverable — a permanently-poisoned memo would wedge the
//   app until reload. The trade-off: concurrent callers that were already sharing
//   a failing in-flight promise all observe that same rejection (they do not each
//   retry mid-flight); retry happens on the NEXT call after the failure settles.

/** A context with no usable key still runs, but is never memoized (degraded path). */
export interface SchemaEnsurer<TCtx> {
  /**
   * Ensure the schema-creation work has run for `ctx`'s key. Resolves once the
   * work has succeeded (either just now, or on a prior/concurrent call).
   * Rejects if the underlying run rejects; a rejection leaves nothing memoized
   * so a subsequent call retries.
   */
  ensure(ctx: TCtx): Promise<void>;
  /** True once a successful run has been memoized for `key`. */
  isReady(key: string): boolean;
  /** Forget all memoized state (both ready and in-flight). Mainly for tests / sign-out. */
  reset(): void;
}

export interface SchemaEnsurerOptions<TCtx> {
  /**
   * Derive the memo key for a context. Return `null` when no stable key is
   * available; the ensurer then runs every time WITHOUT memoizing (it can never
   * be sure two calls refer to the same account).
   */
  keyOf: (ctx: TCtx) => string | null;
  /** The one-time work to run per key (e.g. a CREATE TABLE batch). */
  run: (ctx: TCtx) => Promise<void>;
}

export function createSchemaEnsurer<TCtx>(
  options: SchemaEnsurerOptions<TCtx>,
): SchemaEnsurer<TCtx> {
  const ready = new Set<string>();
  const inFlight = new Map<string, { generation: number; token: symbol; promise: Promise<void> }>();
  // reset() invalidates runs which were already awaiting their underlying work.
  // Those old runs must not repopulate `ready` or delete a newer run's entry.
  let generation = 0;

  function ensure(ctx: TCtx): Promise<void> {
    const key = options.keyOf(ctx);

    // No usable key: run every time, never memoize.
    if (!key) return options.run(ctx);

    if (ready.has(key)) return Promise.resolve();

    const existing = inFlight.get(key);
    if (existing) return existing.promise;

    const runGeneration = generation;
    const runToken = Symbol(key);
    const run = (async () => {
      await options.run(ctx);
      const current = inFlight.get(key);
      if (
        generation === runGeneration &&
        current?.generation === runGeneration &&
        current.token === runToken
      )
        ready.add(key);
    })();

    inFlight.set(key, { generation: runGeneration, token: runToken, promise: run });
    // On success OR failure, drop the in-flight entry. Only success added to
    // `ready`, so a rejection leaves the key un-memoized and the next call retries.
    // A reset may have installed a newer run for the same key meanwhile; only
    // the exact current run is allowed to remove its own entry.
    void run
      .catch(() => {})
      .finally(() => {
        const current = inFlight.get(key);
        if (
          generation === runGeneration &&
          current?.generation === runGeneration &&
          current.token === runToken
        )
          inFlight.delete(key);
      });
    return run;
  }

  return {
    ensure,
    isReady: (key: string) => ready.has(key),
    reset: () => {
      generation++;
      ready.clear();
      inFlight.clear();
    },
  };
}

// ── Mutation guard (generation counter) ──────────────────────────────────────
//
// Extracted from TinyChat's `mutationGen` / `_memoryWriteGen` race guards
// (frontend/src/lib/threadStore.ts:99-108, 605-610, 806-820) as a generic
// mechanism.
//
// WHY THIS EXISTS: browser-direct storage mixes a fast local cache with slow
// (~2s) SQL round-trips. A read (e.g. a background SWR revalidate) may be issued
// BEFORE a mutation (delete / rename) but RESOLVE AFTER it. If the late read is
// applied, it overwrites the cache the mutation already corrected — resurrecting
// deleted or renamed rows. The guard makes that detectable without locks:
//
//   1. Every mutator calls `bump()` BEFORE it touches storage/cache.
//   2. A reader snapshots `const started = guard.current()` before its async read.
//   3. When the read resolves, it checks `guard.changedSince(started)`; if true,
//      a mutation intervened and the read result is DROPPED, not applied.
//
// The counter only ever increases, so "changed since" is a cheap `!==` and there
// is no ABA hazard for this use.

export interface MutationGuard {
  /** Bump the generation (call BEFORE a mutation touches storage). Returns the new value. */
  bump(): number;
  /** Snapshot the current generation (call BEFORE starting an async read). */
  current(): number;
  /**
   * True if any `bump()` happened since `snapshot` was taken — i.e. a read that
   * snapshotted `snapshot` lost a race to a mutation and MUST drop its result.
   */
  changedSince(snapshot: number): boolean;
}

export function createMutationGuard(): MutationGuard {
  let gen = 0;
  return {
    bump: () => ++gen,
    current: () => gen,
    changedSince: (snapshot: number) => gen !== snapshot,
  };
}

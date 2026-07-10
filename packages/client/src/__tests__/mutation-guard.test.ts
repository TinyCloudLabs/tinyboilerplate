import { describe, test, expect } from "bun:test";
import { createMutationGuard } from "../storage/mutation-guard.js";

describe("createMutationGuard", () => {
  test("a read that STARTED before a mutation and RESOLVES after it is dropped", async () => {
    const guard = createMutationGuard();
    const applied: string[] = [];

    // Model a delete: bump happens synchronously before the mutation's own write.
    async function deleteRow() {
      guard.bump();
      applied.push("delete");
    }

    // Model a slow SWR revalidate: snapshot the gen, do a slow read, then only
    // apply the result if no mutation intervened.
    async function slowRead(readResolves: Promise<void>) {
      const started = guard.current();
      await readResolves; // read round-trip in flight…
      if (guard.changedSince(started)) return; // lost the race → drop
      applied.push("read");
    }

    let releaseRead!: () => void;
    const readInFlight = new Promise<void>((r) => (releaseRead = r));

    // 1) Read starts (snapshots gen 0). 2) Delete runs to completion (gen → 1).
    // 3) Read finally resolves — it must be DROPPED, not applied.
    const readPromise = slowRead(readInFlight);
    await deleteRow();
    releaseRead();
    await readPromise;

    expect(applied).toEqual(["delete"]); // the resurrecting "read" never applied
  });

  test("a read with NO intervening mutation is applied", async () => {
    const guard = createMutationGuard();
    const applied: string[] = [];

    const started = guard.current();
    await Promise.resolve(); // simulate the async read
    if (!guard.changedSince(started)) applied.push("read");

    expect(applied).toEqual(["read"]);
  });

  test("bump increases monotonically and returns the new value", () => {
    const guard = createMutationGuard();
    expect(guard.current()).toBe(0);
    expect(guard.bump()).toBe(1);
    expect(guard.bump()).toBe(2);
    expect(guard.current()).toBe(2);
    expect(guard.changedSince(0)).toBe(true);
    expect(guard.changedSince(2)).toBe(false);
  });
});

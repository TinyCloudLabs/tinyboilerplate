import { describe, test, expect } from "bun:test";
import { createSchemaEnsurer } from "../storage/schema-ensurer.js";

// Deferred promise helper so a test can control exactly when a run settles.
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSchemaEnsurer", () => {
  test("N concurrent callers on the same key trigger exactly ONE underlying run", async () => {
    let invokes = 0;
    const gate = deferred();
    const ensurer = createSchemaEnsurer<{ did: string }>({
      keyOf: (ctx) => ctx.did,
      run: async () => {
        invokes++;
        await gate.promise;
      },
    });

    const ctx = { did: "did:pkh:eip155:1:0xabc" };
    // Fire 5 callers before the run settles — they must all share one in-flight run.
    const callers = [
      ensurer.ensure(ctx),
      ensurer.ensure(ctx),
      ensurer.ensure(ctx),
      ensurer.ensure(ctx),
      ensurer.ensure(ctx),
    ];
    // The run has started (once) but not resolved.
    expect(invokes).toBe(1);
    gate.resolve();
    await Promise.all(callers);
    expect(invokes).toBe(1);

    // A later call after success is memoized — still no new run.
    await ensurer.ensure(ctx);
    expect(invokes).toBe(1);
    expect(ensurer.isReady(ctx.did)).toBe(true);
  });

  test("distinct keys each get their own single run", async () => {
    const invokedKeys: string[] = [];
    const ensurer = createSchemaEnsurer<{ did: string }>({
      keyOf: (ctx) => ctx.did,
      run: async (ctx) => {
        invokedKeys.push(ctx.did);
      },
    });
    await Promise.all([
      ensurer.ensure({ did: "a" }),
      ensurer.ensure({ did: "a" }),
      ensurer.ensure({ did: "b" }),
    ]);
    expect(invokedKeys.sort()).toEqual(["a", "b"]);
  });

  test("a rejection does NOT poison the memo — a later call retries", async () => {
    let invokes = 0;
    const ensurer = createSchemaEnsurer<{ did: string }>({
      keyOf: (ctx) => ctx.did,
      // Fail the first invocation, succeed on every retry.
      run: async () => {
        invokes++;
        if (invokes === 1) throw new Error("transient node blip");
      },
    });
    const ctx = { did: "did:pkh:eip155:1:0xretry" };

    await expect(ensurer.ensure(ctx)).rejects.toThrow("transient node blip");
    expect(ensurer.isReady(ctx.did)).toBe(false);

    // The retry must actually re-run (proving the failed key was not memoized).
    await ensurer.ensure(ctx);
    expect(invokes).toBe(2);
    expect(ensurer.isReady(ctx.did)).toBe(true);

    // And now it is memoized: no third run.
    await ensurer.ensure(ctx);
    expect(invokes).toBe(2);
  });

  test("a null key runs every time and never memoizes (degraded path)", async () => {
    let invokes = 0;
    const ensurer = createSchemaEnsurer<{ did: string | null }>({
      keyOf: (ctx) => ctx.did,
      run: async () => {
        invokes++;
      },
    });
    await ensurer.ensure({ did: null });
    await ensurer.ensure({ did: null });
    expect(invokes).toBe(2);
  });

  test("reset() forgets memoized state so the next call re-runs", async () => {
    let invokes = 0;
    const ensurer = createSchemaEnsurer<{ did: string }>({
      keyOf: (ctx) => ctx.did,
      run: async () => {
        invokes++;
      },
    });
    const ctx = { did: "x" };
    await ensurer.ensure(ctx);
    expect(invokes).toBe(1);
    ensurer.reset();
    await ensurer.ensure(ctx);
    expect(invokes).toBe(2);
  });

  test("reset() prevents an older run from marking a newer run ready or removing it", async () => {
    const first = deferred();
    const second = deferred();
    let invokes = 0;
    const ensurer = createSchemaEnsurer<{ did: string }>({
      keyOf: (ctx) => ctx.did,
      run: async () => {
        invokes++;
        await (invokes === 1 ? first.promise : second.promise);
      },
    });
    const ctx = { did: "did:pkh:eip155:1:0xreset-race" };

    const runA = ensurer.ensure(ctx);
    ensurer.reset();
    const runB = ensurer.ensure(ctx);
    expect(invokes).toBe(2);

    first.resolve();
    await runA;
    expect(ensurer.isReady(ctx.did)).toBe(false);

    // A third caller must still join B. If A's finally deleted B's entry, this
    // would launch a third run; if A marked ready, it would resolve immediately.
    let joinedB = false;
    const joined = ensurer.ensure(ctx).then(() => {
      joinedB = true;
    });
    await Promise.resolve();
    expect(invokes).toBe(2);
    expect(joinedB).toBe(false);

    second.resolve();
    await Promise.all([runB, joined]);
    expect(ensurer.isReady(ctx.did)).toBe(true);
  });
});

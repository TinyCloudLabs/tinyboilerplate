import { describe, expect, test } from "bun:test";
import type { TinyCloudWeb } from "@tinycloud/web-sdk";
import type { Task } from "../examples/tasks/frontend/src/lib/taskStore.ts";

class MemoryStorage {
  #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type SqlResult = { ok: true; data?: { rows: unknown[][] } };

function sqlRows(tasks: Task[]): SqlResult {
  return {
    ok: true,
    data: {
      rows: tasks.map((task) => [
        task.id,
        task.title,
        task.done ? 1 : 0,
        task.createdAt,
        task.updatedAt,
      ]),
    },
  };
}

function task(id: string, title: string): Task {
  return {
    id,
    title,
    done: false,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function fakeClient(did: string, query: () => Promise<SqlResult>): TinyCloudWeb {
  return {
    did,
    sql: {
      db: () => ({
        batch: async () => ({ ok: true }),
        query,
        execute: async () => ({ ok: true }),
      }),
    },
  } as unknown as TinyCloudWeb;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition did not become true");
}

// The SDK registers custom elements at module load; these small shims let this
// regression exercise App's pure refresh path in Bun's non-browser test runtime.
Object.assign(globalThis, {
  HTMLElement: class {},
  customElements: { get: () => undefined, define: () => undefined },
});
const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

const { createTaskSessionGate, refreshTasksForSession } =
  await import("../examples/tasks/frontend/src/App.tsx");
const { resetTaskStore } = await import("../examples/tasks/frontend/src/lib/taskStore.ts");

describe("Tasks session epoch", () => {
  test("A's late cache revalidation cannot overwrite B after sign-out and sign-in", async () => {
    const aCached = task("a-cached", "A cached task");
    const aFresh = task("a-fresh", "A late task");
    const bTask = task("b-current", "B current task");
    const aRead = deferred<SqlResult>();
    let aQueries = 0;
    const accountA = fakeClient("did:pkh:eip155:1:0xaaa", () => {
      aQueries++;
      return aRead.promise;
    });
    const accountB = fakeClient("did:pkh:eip155:1:0xbbb", async () => sqlRows([bTask]));
    storage.setItem(`tinytasks:index:${accountA.did}`, JSON.stringify([aCached]));

    const sessions = createTaskSessionGate();
    let visible: Task[] = [];
    const aEpoch = sessions.invalidate();
    const sessionA = sessions.activate(accountA, aEpoch);
    expect(sessionA).not.toBeNull();
    await refreshTasksForSession(sessions, sessionA!, accountA, (tasks) => {
      visible = tasks;
    });
    expect(visible).toEqual([aCached]);
    await waitFor(() => aQueries === 1);

    // Sign-out invalidates A before clearing its store; signing in B obtains a
    // distinct epoch/client/DID before its own list is displayed.
    sessions.invalidate();
    resetTaskStore(accountA);
    const bEpoch = sessions.invalidate();
    const sessionB = sessions.activate(accountB, bEpoch);
    expect(sessionB).not.toBeNull();
    await refreshTasksForSession(sessions, sessionB!, accountB, (tasks) => {
      visible = tasks;
    });
    expect(visible).toEqual([bTask]);

    aRead.resolve(sqlRows([aFresh]));
    await Promise.resolve();
    await Promise.resolve();
    expect(visible).toEqual([bTask]);
  });
});

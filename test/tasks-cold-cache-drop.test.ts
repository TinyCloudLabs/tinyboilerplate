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

function task(id: string): Task {
  return {
    id,
    title: "stale task",
    done: false,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition did not become true");
}

Object.assign(globalThis, {
  HTMLElement: class {},
  customElements: { get: () => undefined, define: () => undefined },
});
const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

const { deleteTask, listTasks } = await import("../examples/tasks/frontend/src/lib/taskStore.ts");

describe("Tasks cold-cache revalidation", () => {
  test("drops a cold read that resolves after a delete instead of applying stale rows", async () => {
    const stale = task("deleted-row");
    const read = deferred<SqlResult>();
    let queries = 0;
    const client = {
      did: "did:pkh:eip155:1:0xcold",
      sql: {
        db: () => ({
          batch: async () => ({ ok: true }),
          query: () => {
            queries++;
            return read.promise;
          },
          execute: async () => ({ ok: true }),
        }),
      },
    } as unknown as TinyCloudWeb;

    const pending = listTasks(client);
    await waitFor(() => queries === 1);
    await deleteTask(client, stale.id);
    read.resolve(sqlRows([stale]));

    await expect(pending).resolves.toEqual({ status: "dropped" });
    expect(storage.getItem(`tinytasks:index:${client.did}`)).toBeNull();
  });
});

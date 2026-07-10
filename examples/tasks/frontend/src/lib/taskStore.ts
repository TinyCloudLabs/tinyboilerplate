import type { TinyCloudWeb } from "@tinycloud/web-sdk";
import {
  assertDdlActionsGranted,
  assertFullPathDbHandle,
  createDidKeyedCache,
  createMutationGuard,
  createSchemaEnsurer,
  resolveSqlDbHandle,
} from "@tinyboilerplate/client";
import manifest from "../../../manifest.json";

// ── Browser-direct SQL task store ─────────────────────────────────────────────
//
// This is the ONE piece of app-specific glue. Every concurrency guardrail is a
// reused, unit-tested helper from @tinyboilerplate/client — this file only wires
// them to a `tasks` table. There is NO backend: the signed-in session already
// holds the tinycloud.sql capability on its own space and writes browser-direct.
//
// Contrast with examples/notes, which routes all storage through a delegating
// backend. See docs/app-architecture.md for when to pick which pattern.

export const APP_ID = "xyz.tinycloud.tasks";

// The SQL grant this app requests (from manifest.json). Used to assert locally,
// before any DDL batch, that the schema-creation is authorized — failing with a
// clear message instead of a runtime 401.
const SQL_ACTIONS: readonly string[] =
  manifest.permissions.find((p) => p.service === "tinycloud.sql")?.actions ?? [];

// Full resolved db handle. MUST be `${APP_ID}/<db>` — a bare db("tasks") 401s
// because the SQL service authorizes against the full granted resource string.
// resolveSqlDbHandle builds it; assertFullPathDbHandle documents+enforces the rule.
const TASKS_DB = resolveSqlDbHandle(APP_ID, "tasks");
assertFullPathDbHandle(TASKS_DB, APP_ID);

// Schema. Because the manifest grants `schema`, this app may freely CREATE INDEX
// — the "no CREATE INDEX" lore is really "DDL needs the schema ability", which we
// have. assertDdlActionsGranted proves that locally at module load.
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // Legal here (schema is granted). Speeds the ORDER BY updated_at list query.
  `CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks (updated_at)`,
];
assertDdlActionsGranted(SCHEMA, SQL_ACTIONS);

export interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A completed list read is either safe to apply or was dropped after a mutation race. */
export type ListTasksResult = { status: "applied"; tasks: Task[] } | { status: "dropped" };

/** Minimal structural view of a SQL Result (never thrown — surfaced as .error). */
interface SqlResult {
  ok: boolean;
  data?: { rows: unknown[][] };
  error?: { code: string; message: string };
}

/** A tcw.sql db handle — narrowed to the ops this store uses. */
interface SqlDb {
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<SqlResult>;
  query(sql: string, params?: unknown[]): Promise<SqlResult>;
  execute(sql: string, params?: unknown[]): Promise<SqlResult>;
}

function db(tcw: TinyCloudWeb): SqlDb {
  // The SDK's sql surface is not exported as a precise type here; this store owns
  // the narrow contract above and casts once at the boundary.
  return (tcw as unknown as { sql: { db(name: string): SqlDb } }).sql.db(TASKS_DB);
}

function fail(result: SqlResult, context: string): never {
  const err = result.error;
  throw new Error(`${context}: [${err?.code ?? "SQL_ERROR"}] ${err?.message ?? "unknown"}`);
}

// ── Guardrails wired to this store ────────────────────────────────────────────

// One shared schema batch per account (never N parallel batches on boot).
const schema = createSchemaEnsurer<TinyCloudWeb>({
  keyOf: (tcw) =>
    (typeof tcw.did === "string" && tcw.did) ||
    (typeof tcw.spaceId === "string" && tcw.spaceId) ||
    null,
  run: async (tcw) => {
    const res = await db(tcw).batch(SCHEMA.map((sql) => ({ sql })));
    if (!res.ok) fail(res, "ensureSchema");
  },
});

// Drops a stale SWR read that lost a race to a mutation (delete/toggle/rename).
const mutations = createMutationGuard();

// Instant-paint cache, keyed on the DID so it survives a session restore.
const cache = createDidKeyedCache<Task[]>({ namespace: "tinytasks:index" });

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function rowToTask(row: unknown[]): Task {
  return {
    id: String(row[0] ?? ""),
    title: String(row[1] ?? ""),
    done: Number(row[2] ?? 0) !== 0,
    createdAt: String(row[3] ?? ""),
    updatedAt: String(row[4] ?? ""),
  };
}

async function readAll(tcw: TinyCloudWeb): Promise<Task[]> {
  await schema.ensure(tcw);
  const res = await db(tcw).query(
    "SELECT id, title, done, created_at, updated_at FROM tasks ORDER BY updated_at DESC",
  );
  if (!res.ok) fail(res, "listTasks");
  return (res.data?.rows ?? []).map(rowToTask);
}

/**
 * List tasks, newest first. Stale-while-revalidate: if a cache exists, return it
 * immediately and refresh in the background via `onFresh`. The background read is
 * dropped if a mutation intervened (guarding against resurrecting deleted rows).
 */
export async function listTasks(
  tcw: TinyCloudWeb,
  onFresh?: (tasks: Task[]) => void,
): Promise<ListTasksResult> {
  const cached = cache.read(tcw);
  if (cached && cached.length > 0) {
    const started = mutations.current();
    void readAll(tcw)
      .then((fresh) => {
        if (mutations.changedSince(started)) return; // lost the race → drop
        cache.write(tcw, fresh);
        onFresh?.(sortTasks(fresh));
      })
      .catch((err) => console.warn("[taskStore] background revalidate failed", err));
    return { status: "applied", tasks: sortTasks(cached) };
  }
  const started = mutations.current();
  const fresh = await readAll(tcw);
  if (mutations.changedSince(started)) return { status: "dropped" };
  const tasks = sortTasks(fresh);
  cache.write(tcw, fresh);
  return { status: "applied", tasks };
}

export async function createTask(tcw: TinyCloudWeb, title: string): Promise<Task> {
  mutations.bump();
  await schema.ensure(tcw);
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    done: false,
    createdAt: now,
    updatedAt: now,
  };
  const res = await db(tcw).execute(
    "INSERT INTO tasks (id, title, done, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
    [task.id, task.title, now, now],
  );
  if (!res.ok) fail(res, "createTask");
  patchCache(tcw, task);
  return task;
}

export async function setTaskDone(tcw: TinyCloudWeb, id: string, done: boolean): Promise<void> {
  mutations.bump();
  await schema.ensure(tcw);
  const now = new Date().toISOString();
  const res = await db(tcw).execute("UPDATE tasks SET done = ?, updated_at = ? WHERE id = ?", [
    done ? 1 : 0,
    now,
    id,
  ]);
  if (!res.ok) fail(res, "setTaskDone");
  const cached = cache.read(tcw);
  if (cached) {
    const prior = cached.find((t) => t.id === id);
    if (prior) patchCache(tcw, { ...prior, done, updatedAt: now });
  }
}

export async function deleteTask(tcw: TinyCloudWeb, id: string): Promise<void> {
  mutations.bump();
  await schema.ensure(tcw);
  const res = await db(tcw).execute("DELETE FROM tasks WHERE id = ?", [id]);
  if (!res.ok) fail(res, "deleteTask");
  const cached = cache.read(tcw);
  if (cached)
    cache.write(
      tcw,
      cached.filter((t) => t.id !== id),
    );
}

/** Patch a single task into an existing cache (no-op if the cache is cold). */
function patchCache(tcw: TinyCloudWeb, task: Task): void {
  const cached = cache.read(tcw);
  if (!cached) return;
  cache.write(tcw, [...cached.filter((t) => t.id !== task.id), task]);
}

/** Forget all in-memory + cached state for the current account (used on sign-out). */
export function resetTaskStore(tcw: TinyCloudWeb): void {
  // Bump first: an SWR revalidate in flight at sign-out must lose the
  // changedSince race, or its resolution would re-cache the signed-out
  // account's rows under its DID key after cache.remove().
  mutations.bump();
  schema.reset();
  cache.remove(tcw);
}

// ── Browser-direct tcw.sql authorizer constraints ────────────────────────────
//
// Two hard-won constraints govern browser-direct SQL against a TinyCloud node.
// Both were paid for by TinyChat; both are encoded here as ENFORCED ASSERTIONS
// (not just comments) so a browser-direct app fails loudly and locally instead of
// with a mysterious 401 at runtime.
//
// ── Constraint 1: DDL requires the `tinycloud.sql/schema` ability ─────────────
//
// THE RULE (measured live on SDK 2.5.1 / node v1.4.2, 2026-07-08): every DDL
// statement — CREATE TABLE, CREATE INDEX, ALTER, DROP, triggers, views — is
// requested by `@tinycloud/sdk-services` (>= 2.4.2) under the ability
// `tinycloud.sql/schema`. Under a `[read, write]` grant, DDL is DENIED at the
// capability layer with `401 AUTH_UNAUTHORIZED`, `req=tinycloud.sql/schema`,
// BEFORE the node's per-statement authorizer is even consulted.
//
// This corrects a persistent piece of lore: it is NOT "the node rejects
// CREATE INDEX". TinyChat's comment said "no CREATE INDEX *under a read+write
// grant*" — that qualifier is the whole finding. There is one coherent rule, not
// a per-statement blocklist: DDL needs `schema`. An app whose manifest grants
// `["read","write","schema"]` may freely CREATE INDEX (as examples/tasks does).
//
// ── Constraint 2: the SQL db handle must be the FULL path `${appId}/<db>` ──────
//
// The SQL service sends the db name VERBATIM as the invoke path (it does NOT
// app-prefix like KV does). The session capability grants the SQL resource at the
// manifest path resolved with the app id (e.g. `xyz.tinycloud.tasks/tasks`), so
// the handle passed to `tcw.sql.db(...)` MUST be that full resolved path. Passing
// a bare `db("tasks")` 401s. The node derives the SQLite FILE from the last path
// segment but AUTHORIZES against the full resource string.

/** Matches a DDL statement (schema-altering). Anchored on the leading keyword. */
const DDL_PATTERN =
  /^\s*(?:CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?(?:TABLE|INDEX|UNIQUE\s+INDEX|VIEW|TRIGGER|VIRTUAL\s+TABLE)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)|REINDEX)\b/i;

/** The ability every DDL statement is requested under (since sdk-services 2.4.2). */
export const SQL_SCHEMA_ACTION = "schema";

/** True if `sql` is a DDL (schema-altering) statement that needs `schema`. */
export function isDdlStatement(sql: string): boolean {
  return DDL_PATTERN.test(sql);
}

/**
 * Assert that a set of SQL statements is authorized by the granted actions.
 * Throws if any statement is DDL but `schema` is not among `grantedActions`.
 * Call this before issuing a schema-creation batch to fail locally rather than
 * with a runtime 401.
 */
export function assertDdlActionsGranted(
  statements: string[],
  grantedActions: readonly string[],
): void {
  const ddl = statements.filter(isDdlStatement);
  if (ddl.length === 0) return;
  if (grantedActions.includes(SQL_SCHEMA_ACTION)) return;
  const first = ddl[0].trim().split(/\s+/).slice(0, 3).join(" ");
  throw new Error(
    `tinycloud.sql DDL requires the "${SQL_SCHEMA_ACTION}" ability, but the grant only has ` +
      `[${grantedActions.join(", ")}]. ${ddl.length} DDL statement(s) present (e.g. "${first} …"). ` +
      `Add "${SQL_SCHEMA_ACTION}" to the manifest's tinycloud.sql actions.`,
  );
}

/**
 * Build the full SQL db handle `${appId}/${db}`. `db` must be a single path
 * segment (no "/"). Throws on empty inputs or a slashed `db` so a caller that
 * accidentally passes an already-resolved path (double-prefixing) fails fast.
 */
export function resolveSqlDbHandle(appId: string, db: string): string {
  if (!appId) throw new Error("resolveSqlDbHandle: appId is required");
  if (!db) throw new Error("resolveSqlDbHandle: db name is required");
  if (db.includes("/")) {
    throw new Error(
      `resolveSqlDbHandle: db name "${db}" must be a single segment, not a path — ` +
        `pass "tasks", not "${appId}/tasks". The full handle is built for you.`,
    );
  }
  return `${appId}/${db}`;
}

/**
 * Assert a handle is the full resolved path for `appId` (starts with `${appId}/`
 * and has a non-empty segment after it). Throws with the bare-name trap spelled
 * out — the single most common browser-direct SQL 401.
 */
export function assertFullPathDbHandle(handle: string, appId: string): void {
  const prefix = `${appId}/`;
  if (!handle.startsWith(prefix) || handle.length <= prefix.length) {
    throw new Error(
      `tinycloud.sql db handle "${handle}" must be the FULL resolved path "${appId}/<db>". ` +
        `A bare name like db("tasks") 401s because the SQL service authorizes against the ` +
        `full granted resource string, not the last path segment.`,
    );
  }
}

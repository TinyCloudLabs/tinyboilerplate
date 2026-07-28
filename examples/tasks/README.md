# TinyCloud Tasks — browser-direct example

A small SQL task list that writes **browser-direct** to `tcw.sql`. There is **no
backend**: the signed-in session already holds the `tinycloud.sql` capability on
its own space, so the browser reads and writes it directly.

Contrast with [`examples/notes`](../notes), which routes all storage through a
delegating backend. See [`docs/app-architecture.md`](../../docs/app-architecture.md)
for the two patterns and when to pick which.

## What it demonstrates

This example is deliberately small but SQL-shaped enough to exercise every
concurrency guardrail extracted into `@tinyboilerplate/client` (from TinyChat's
`threadStore.ts`). All of the guardrails are reused, unit-tested helpers — the
only app-specific code is `src/lib/taskStore.ts`, which wires them to a `tasks`
table:

| Helper | Role here |
|---|---|
| `createSchemaEnsurer` | One shared schema batch per account — never N parallel `CREATE TABLE` batches on boot (the node degrades under parallel invokes). |
| `createMutationGuard` | Drops a stale stale-while-revalidate read that lost a race to a delete/toggle (otherwise deleted rows resurrect). |
| `createDidKeyedCache` | Instant-paint localStorage cache keyed on the primary **DID** (not `spaceId`, which is `undefined` on a restored session). |
| `resolveSqlDbHandle` / `assertFullPathDbHandle` | The db handle must be the full path `${APP_ID}/tasks`; a bare `db("tasks")` 401s. |
| `assertDdlActionsGranted` | DDL (`CREATE TABLE`, `CREATE INDEX`) requires the `tinycloud.sql/schema` ability. |

### The `schema` ability and `CREATE INDEX`

`manifest.json` grants `tinycloud.sql` the actions `["read", "write", "schema"]`.
The `schema` action is **load-bearing**: every DDL statement — including
`CREATE INDEX` — is requested under `tinycloud.sql/schema`. Under a `read+write`
grant, DDL is denied with `401 AUTH_UNAUTHORIZED`. Because this app grants
`schema`, it can freely create an index (`idx_tasks_updated`). There is no
"no `CREATE INDEX`" rule — the real, single rule is "DDL needs `schema`".

## Run it

```bash
bun install
bun run dev:tasks   # serves the frontend on http://localhost:5176
```

Sign in with OpenKey; tasks persist in your TinyCloud space and sync to any
device you sign into.

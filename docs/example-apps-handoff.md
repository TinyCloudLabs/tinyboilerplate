# TinyBoilerplate Example Apps Handoff

This handoff is for the next agent working on TinyBoilerplate examples. The
goal is to grow the repo into a reliable foundation for new TinyCloud apps by
adding small, focused examples one at a time.

## Current Repo State

- Repo: `TinyCloudLabs/tinyboilerplate`
- Working branch: `codex/tinyboilerplate-vnext-hardening`
- PR: https://github.com/TinyCloudLabs/tinyboilerplate/pull/43
- TinyCloud SDK line: `2.2.0-beta.12`
- Root `bun.lock` is intended to be committed and used with
  `bun install --frozen-lockfile`
- `docs/new-app.md` explains how to create a new app from the scaffold

Existing tracked examples:

- `examples/react-express`: the clean generic starter and intended default
  copy/fork base.
- `examples/conversation-sync`: a large Listen-derived advanced reference app.
  It is useful as reference material, but it should not be copied as the normal
  starting point for new apps.

Listen is not part of this repo as a dependency, submodule, or fork base. Treat
Listen only as a separate reference implementation.

## Product Direction

The repo should not become a gallery of half-real demos. It should become a
ladder of examples where each app teaches one TinyCloud capability clearly:

1. a clean starter
2. user-owned data
3. sharing/delegation
4. agent-readable manifests and docs
5. external ingestion
6. AI context approval and generated artifacts
7. advanced reference behavior

Each example should be small enough to understand and copy. Prefer boring,
complete flows over flashy surfaces.

## Proposed Example Ladder

### 1. Clean Starter App

Status: already represented by `examples/react-express`.

Possible follow-up: rename or document it more explicitly as the starter, but do
not do that unless the user asks. Avoid destabilizing the existing hardening PR.

### 2. User-Owned Notes / Bookmarks

Priority: build this first.

Purpose: demonstrate a normal app whose data is owned by the user in TinyCloud.
This should feel like the missing middle between `react-express` and
`conversation-sync`.

Concept:

- A small notes/bookmarks app.
- Users can create, edit, delete, tag, and search entries.
- Data is stored in TinyCloud under the app's own app id.
- Backend supports authenticated API operations.
- Frontend also demonstrates at least one direct browser TinyCloud operation if
  that can be done without making the example confusing.

TinyCloud concepts to teach:

- OpenKey sign-in
- TinyCloud session and space setup
- backend delegation grant
- KV for document bodies or bookmark payloads
- SQL for searchable index rows
- app-specific storage prefixes
- clean localStorage/session key names

Non-goals:

- no AI
- no external webhooks
- no user-to-user sharing
- no Listen-specific identifiers, transcript model, or source integrations

Suggested app id:

```text
xyz.tinycloud.notes
```

Suggested path:

```text
examples/notes-bookmarks
```

Suggested implementation route:

1. Start from `examples/react-express`, not from `examples/conversation-sync`.
2. Rename the packages, app id, manifest, server-info, storage keys, README, and
   API title.
3. Replace the placeholder `Item` model with `Note` or `Bookmark`.
4. Use SQL for metadata rows:
   - `id`
   - `title`
   - `url` if using bookmarks
   - `tags`
   - `created_at`
   - `updated_at`
   - `kv_key`
5. Use KV for the full note body, bookmark description, or raw payload.
6. Add backend tests for create, update, search/list, and delete.
7. Add a short README that explains what this example teaches and how it differs
   from the starter.

Acceptance criteria:

- `bun install --frozen-lockfile` works.
- `bun run format:check` passes.
- `bun run build` passes.
- Existing package/backend tests still pass.
- The new example has focused backend tests.
- The new README states that this is the recommended first real example after
  the starter.

### 3. Shared Collection / Team Board

Priority: build after Notes / Bookmarks.

Purpose: teach user-to-user delegation without product complexity.

Concept:

- Alice owns a simple collection or board.
- Bob receives read-only or read-write access.
- UI should make the permission boundary visible.

TinyCloud concepts to teach:

- user-to-user delegation
- read vs write capability scope
- delegated access UX
- capability expiration or stale grant handling if already supported cleanly

Non-goals:

- no team admin system
- no billing
- no multi-tenant SaaS abstraction

### 4. Agent-Readable App

Priority: build after sharing, or earlier if agent interoperability becomes the
top priority.

Purpose: show how a TinyCloud app can be legible to agents without becoming
Listen-specific.

Concept:

- A tiny app with useful manifest descriptions, server-info, and agent-facing
  docs.
- Read-only delegation to an agent-like backend or local tool.
- Keep the actual domain very small so the focus stays on agent readability.

TinyCloud concepts to teach:

- manifest permission descriptions
- server-info permission surface
- agent docs or equivalent app-readable guidance
- read-only delegated data access

### 5. Webhook Ingest App

Priority: build only after the first three examples are solid.

Purpose: replace Fireflies/Google-Meet-specific learning with a generic ingest
pattern.

Concept:

- A simple external webhook inbox.
- Incoming events are verified, deduplicated, normalized, and stored in the
  user's TinyCloud storage.

TinyCloud concepts to teach:

- backend-owned secrets
- webhook verification
- idempotent imports
- pending queues
- normalized SQL rows plus KV payloads

Non-goals:

- no Fireflies, Granola, Google Meet, or transcript-specific product code

### 6. AI Brief / Corpus-to-Artifact App

Priority: strategic, but build later so it can rely on the earlier examples.

Purpose: demonstrate a privacy-conscious AI workflow that reads approved
TinyCloud context and writes generated artifacts to the app's own storage.

Concept:

- User selects a data source.
- App shows a context preview.
- User approves a batch of excerpts.
- Backend sends only approved context to an AI provider.
- App stores generated brief/spec/artifact in its own TinyCloud storage.

TinyCloud concepts to teach:

- cross-app read-only access
- explicit context approval
- generated app-owned artifacts
- evidence/citation mapping back to approved excerpts

Non-goals:

- no large Abracadabra clone
- no broad agent marketplace
- no hidden AI context upload

### 7. Advanced Reference App

Status: already represented by `examples/conversation-sync`.

Keep it clearly labeled as advanced reference. If it is improved later, avoid
turning it into the default scaffold.

## Development Constraints

- Preserve the existing examples while adding new ones.
- Do not port Listen product code into generic examples.
- Keep new examples scoped and teachable.
- Use the repo's existing package/workspace patterns.
- Prefer copying the starter and reducing it over copying the advanced example.
- Keep test coverage proportional but concrete: route tests and at least one
  happy-path storage test are more useful than broad snapshots.
- Avoid changing shared packages unless the new example proves a generic gap.

## Verification Baseline

Before handing work back, run:

```bash
bun install --frozen-lockfile
bun run format:check
bun run build
bun test packages/client/src packages/server/src examples/react-express/backend/src examples/conversation-sync/backend/src
cd examples/conversation-sync/frontend && bunx vitest run
```

For a new example, add its backend test path to the focused test command. If it
has frontend tests, include them in the example's README and in the handoff.

## Known Follow-Up Issue

During the example audit, `examples/react-express/backend/src/routes/delegations.ts`
was found to expose error `detail` and `stack` for invalid delegation failures,
with a comment saying `Revert before merging`. This appears pre-existing. Fix it
before using that route as the base for more examples, or make the new example
avoid copying that debug response.

## Recommended Next Agent Task

Build `examples/notes-bookmarks` as the first new real app example.

Start with a narrow implementation:

- copy the React + Express example structure
- rename the app to Notes or Bookmarks
- add one data model
- store metadata in SQL and content in KV
- add backend tests
- write a focused README
- keep UI simple and functional

Do not start the sharing, agent, webhook, or AI examples in the same pass.

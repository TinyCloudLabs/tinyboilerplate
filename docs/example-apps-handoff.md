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
- `README.md` and `templates/app-starter/README.md` explain how to create and
  verify a new app from the scaffold

Existing tracked examples:

- `templates/app-starter`: the canonical blank reusable starter source.
- `examples/notes`: the first real product example after the blank starter.

This repo must stay self-contained. Do not reference separate product apps,
private readmes, proprietary domains, or named external implementations in
public TinyBoilerplate docs.

## Product Direction

The repo should not become a gallery of half-real demos. It should become a
ladder of examples where each app teaches one TinyCloud capability clearly:

1. a clean starter
2. user-owned data
3. sharing/delegation
4. agent-readable manifests and docs
5. external ingestion
6. AI context approval and generated artifacts
7. advanced reference behavior, when there is a current maintained example

Each example should be small enough to understand and copy. Prefer boring,
complete flows over flashy surfaces.

## Proposed Example Ladder

### 1. Clean Starter App

Status: represented by `templates/app-starter`. Use the scaffold command rather
than raw-copying the template when creating a user-facing app.

### 2. User-Owned Notes / Bookmarks

Status: represented by `examples/notes`.

Purpose: demonstrate a normal app whose data is owned by the user in TinyCloud.
This should feel like the missing middle after the blank starter.

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
- no product-specific identifiers, proprietary data models, or source integrations

Suggested app id:

```text
xyz.tinycloud.notes
```

Suggested implementation route:

1. Start from `templates/app-starter` through the scaffold command, not from
   old reference examples.
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
- Browser runtime verification covers OpenKey sign-in, backend delegation, and
  create/edit/list/delete against the running app. Build/tests alone are only
  unauthenticated smoke checks.

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
specific to any existing product app.

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

Purpose: demonstrate a generic ingest pattern without provider-specific product
assumptions.

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

- no provider-specific or proprietary product code

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

- no large existing-product clone
- no broad agent marketplace
- no hidden AI context upload

### 7. Advanced Reference App

Status: not currently represented in this repo.

If a maintained advanced example is added later, keep it clearly labeled as an
advanced reference and avoid turning it into the default scaffold. Any
architecture material imported from outside this repo must first be rewritten as
generic TinyCloud guidance with product names, domains, and proprietary details
removed.

## Development Constraints

- Preserve the existing examples while adding new ones.
- Do not port product-specific code into generic examples.
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
bun test packages/client/src packages/server/src templates/app-starter/backend/src examples/notes/backend/src
bun run test:browser:app-shell
```

For a new example, add its backend test path to the focused test command. If it
has frontend tests, include them in the example's README and in the handoff.

## Recommended Next Agent Task

Build the next example after `examples/notes`, such as a small sharing app that
teaches user-to-user delegation.

Start with a narrow implementation:

- copy the React + Express example structure
- rename the app to a sharing-focused product, for example Shared Lists
- add one shared data model
- store ownership/sharing metadata in SQL and item content in KV
- include a user-to-user delegation grant and revoke path
- add backend tests
- write a focused README
- keep UI simple and functional

Do not start the sharing, agent, webhook, or AI examples in the same pass.

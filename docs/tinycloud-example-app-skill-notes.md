# TinyCloud Example App Skill Notes

Working notes for a future Codex skill about building real TinyCloud proof-case apps.
This is not the skill yet.

## Source Contract

These notes mix canonical skill instructions with implementation references.
When writing the future skill, promote only the canonical items below. Treat
older examples, audit notes, and legacy harnesses as reference material unless
they match the current scaffold path and verification flow.

Canonical instructions:

- Treat `docs/new-app.md` as the architecture contract.
- Treat `bun run scaffold:app -- ...` as the skill/user-facing app creation
  path.
- Treat `templates/app-starter` as the canonical blank app source inside this
  repo.
- A standalone scaffold must include `templates/app-starter`, `packages/core`,
  `packages/client`, `packages/server`, root `package.json`,
  `tsconfig.base.json`, `turbo.json`, and `.gitignore`.
- Raw template copy alone is not standalone because `workspace:*` dependencies
  and `tsconfig` paths assume the source repo layout.
- Exclude generated artifacts from scaffold output: `dist`, `.turbo`,
  `node_modules`, and `*.tsbuildinfo`.
- Use a hidden-file-aware walker or `rg -uu` during copy/rename/replacement so
  `.env.example` files are included.
- Browser owns identity connection, user consent, TinyCloud sign-in, and delegation creation.
- Backend verifies backend sessions and touches user data only through activated delegated TinyCloud access.
- TinyCloud remains the data and permission boundary.
- A restored backend session is useful for active delegated routes, but it is not a live wallet/provider session and cannot create fresh delegations.

Reference material:

- Use `examples/notes` as the first real implementation reference for patterns
  such as resolved policy hashing, stale-policy invalidation, multi-resource
  delegation activation, and SQL/KV consistency.
- Do not reference separate product apps, private readmes, proprietary domains,
  or named external implementations. If outside architecture context is needed,
  first rewrite it as generic TinyCloud guidance before using it as skill
  material.
- Do not make legacy or outdated e2e harnesses canonical skill instructions.
  Exclude old app-specific browser harnesses, generated-app CLI experiments,
  and reference-app-only scripts unless they are updated to the current
  scaffold output and verification commands below.
- Prefer the current scaffold integration test, focused backend route tests,
  package builds, and a minimal browser smoke over copying reference-app e2e
  suites into new apps.

## Scaffold Trap List

- Prefer structured replacements over broad prose replacement. Update manifests,
  package JSON, env examples, OpenAPI, code constants, tests, and docs through
  typed JSON/YAML/AST or narrowly scoped edits where possible.
- Checklist for every scaffold: app id, app name, frontend package, backend
  package, backend operational prefix, frontend/backend ports, env examples,
  OpenAPI title/servers, UI labels, session/localStorage keys, tests, and docs.
- Keep local auth verification on trusted HTTP or trusted HTTPS. WebAuthn fails
  on TLS warning pages even after the browser interstitial is bypassed.
- Preserve stale-policy behavior: policy hash drift must evict old delegations
  and force re-consent.
- Bind accepted delegations to the authenticated user and the current backend
  delegatee DID before activation/storage.
- Use an app-isolated backend prefix so operational KV state and delegation
  records do not collide across apps.

## App Manifest Pattern

- Keep the source/runtime app manifest focused on app data permissions only.
- Do not add legacy `backend` or `delegations` fields to v1 manifests.
- Prefer `defaults: false` with explicit permissions for proof-case apps.
- Use stable app ids before user data exists; changing `app_id` later is a migration.
- Permission descriptions are explanatory, not capability-expanding.

## Backend Policy Pattern

- Put backend delegation policy in one source module.
- Derive `/api/server-info` from that module.
- Resolve requested backend permissions against the runtime manifest before comparing or hashing.
- Validate backend policy is a subset of the runtime manifest.
- Hash the resolved concrete policy and store the hash with accepted delegations.
- Include `policyHash` in `/api/server-info` for every backend, worker, or agent
  that participates in delegation. This is canonical, not optional reference
  behavior.
- If the policy hash changes, delegation status and middleware should evict the old delegation and force re-consent.

## Delegation Handling

- `GET /api/delegations/status` should distinguish at least `none`, `expired`, `stale`, and `active`.
- `POST /api/delegations` should deserialize, extract resources, validate coverage, activate the delegation, then store it.
- Store serialized delegation, expiry, resolved resources, and policy hash keyed by the stable user identity.
- Middleware should check stored delegation state even when delegated access is cached, so stale policy does not stay active.

## Storage Boundary Pattern

- Use explicit storage helpers for every named SQL database.
- Do not rely on SDK default SQL shortcuts for app data routes.
- Resolve SQL database identifiers from the same manifest/policy module used for delegation checks.
- For TinyCloud Notes:
  - SQL database identifier: `xyz.tinycloud.notes/notes_index`
  - KV prefix: `xyz.tinycloud.notes/entries/`
  - SQL stores metadata.
  - KV stores note body/content.
- TinyCloud SQL error messages show the full checked URI with the service
  prefix, for example `applications/sql/xyz.tinycloud.notes/notes_index`. Do
  not copy the `sql/` service prefix into the manifest path. The manifest path
  should remain app-relative (`notes_index`) and resolve to the SQL database id
  (`xyz.tinycloud.notes/notes_index`).

## Backend Route Shape

- Public:
  - `GET /health`
  - `GET /api/manifest`
  - `GET /api/server-info`
  - `GET /api/openapi.json`
  - `GET /api/auth/nonce`
- Authenticated:
  - `POST /api/auth/verify`
  - `GET /api/delegations/status`
  - `POST /api/delegations`
  - `DELETE /api/delegations`
- Authenticated and delegated:
  - product data routes, for example notes CRUD.

## Product Scope Discipline

- Build a real product surface, not placeholder CRUD.
- Keep the first app intentionally small.
- Avoid AI, sharing, OAuth sources, webhooks, rich text, scraping, previews, and secrets unless explicitly requested.
- Do not accept secret-like values in backend data routes.

## Frontend State Model

- Use explicit states rather than one boolean `isSignedIn`.
- TinyCloud Notes used:
  - `booting`
  - `unauthenticated`
  - `backendSessionRestored`
  - `connectingIdentity`
  - `fetchingPolicy`
  - `signingTinyCloudSession`
  - `verifyingBackendSession`
  - `checkingDelegation`
  - `needsDelegation`
  - `delegationExpired`
  - `delegationStale`
  - `ready`
  - `saving`
  - `recoverableError`
- The UI should clearly distinguish restored backend session from live identity/provider connection.

## Testing Pattern

- Start with focused backend tests where practical:
  - Manifest has explicit app/data permissions only.
  - Backend policy resolves against manifest and hashes concrete permissions.
  - Delegation routes store policy hash and reject insufficient grants.
  - Stale policy status evicts stored delegation and cache.
  - Product CRUD writes to explicit SQL database and KV prefix.
  - Secret-like backend payloads are rejected.
- Browser smoke can be unauthenticated and mocked/no-credential by default.
- For passkey/OpenKey flows in Chrome, avoid TLS certificate errors. WebAuthn is
  blocked on origins with certificate errors even if the user clicks through the
  interstitial.
  Searchable error:
  `WebAuthn is not supported on sites with TLS certificate errors`.
- Keep frontend and backend protocols aligned in local dev. If the frontend is
  HTTPS, default backend fetches should also use HTTPS or Firefox can surface a
  generic `NetworkError when attempting to fetch resource`.
- If local cert files exist, make frontend and backend dev servers both use
  them and set backend CORS to the matching HTTPS frontend origin.
- TinyCloud KV delete may complete with an empty/no-content response that the
  current SDK reports as `Error parsing XML: no root element`. Treat that exact
  parse error as a completed idempotent delete, but keep surfacing auth,
  policy, network, and normal storage errors. Add a regression test for the
  route that hit it.

## Verification Pattern

- Run locked install after adding workspaces:
  - `bun install --frozen-lockfile`
- If the new workspace requires a lockfile update, run `bun install`, then re-run frozen install.
- For the in-repo template/example workflow, run:
  - `bun run format:check`
  - `bun run build`
  - `bun test templates/app-starter/backend/src`
  - focused backend tests, for example `bun test examples/notes/backend/src`
  - `bun run test:browser:app-shell`
  - frontend build for the new app.
- For a scratch scaffold, run:
  - `bun run scaffold:app -- --out ../scratch-app --app-id xyz.tinycloud.scratch --app-name "Scratch TinyCloud App" --backend-prefix xyz.tinycloud.scratch-backend --frontend-package @scratch/tinycloud-frontend --backend-package @scratch/tinycloud-backend --frontend-port 5185 --backend-port 3013`
  - `cd ../scratch-app`
  - `bun install`
  - `bun run build`
  - `bun run test`
- Expect Vite/TinyCloud SDK browser warnings about `buffer` in this repo; they are not new app failures.

## TinyCloud Notes Implementation Observations

- `examples/notes` was cleaner as a new app than copying starter source wholesale.
- Starter was useful as a reference for SIWE/session basics.
- The most important reusable abstraction was not a shared package refactor; it was a local manifest/policy module inside the example.
- Avoid broad package refactors unless a generic gap actually blocks the app.
- TinyCloud Notes local login should use a trusted mkcert origin:
  `frontend/localhost.pem` plus `frontend/localhost-key.pem`. The backend can
  auto-detect those files and serve HTTPS on the matching backend port.
- If authenticated note listing fails with `401 - Unauthorized Action ... / tinycloud.sql/write`,
  first check delegated access activation. A portable delegation with multiple
  resources must be activated per resource and then combined. Calling
  `node.useDelegation()` once on a multi-resource delegation can produce an
  access object whose SQL handle is not authorized for the SQL database even
  though the stored delegation status is `active`.
- When combining per-resource delegated access objects, copy only the handle for
  the service that was just activated. SDK access objects can expose additional
  handles scoped to the active resource path; blindly copying every present
  handle can overwrite a correct KV handle with one scoped under the SQL
  database path, which causes note body writes to fail with `tinycloud.kv/put`
  authorization errors.
- For split SQL metadata plus KV body models, avoid inserting metadata before
  the body write succeeds. A failed KV write leaves an orphan SQL row, and later
  list/detail hydration can 500 on the missing body. Write KV first, clean it up
  if metadata insert fails, and make list hydration skip missing-body orphan rows
  without masking authorization errors.

## Deep Audit Findings To Fold Back Into The Skill

Faraday audited TinyCloud Notes against `docs/new-app.md` after the first
implementation pass. Keep these as hard requirements before treating the
example as skill-quality.

- Delegations must be bound to the authenticated user. `POST /api/delegations`
  cannot store an activated portable delegation under `req.user.address` based
  only on resource coverage. The backend must verify the delegation's user
  identity or delegator matches the backend session identity and that the
  delegatee is the current backend DID before activation/storage.
- Backend-owned operational state must be app-isolated. Do not let multiple
  examples share default backend KV prefixes or delegation keys such as
  `boilerplate-be` plus `delegations/{address}`. Use an app-specific backend
  prefix or include the app id in delegation store keys.
- Split SQL/KV writes need explicit compensation. Update and delete paths must
  account for partial failures so SQL metadata and KV note bodies do not drift
  silently.
- Delegation status contracts must include stale-policy states everywhere:
  shared types, frontend state handling, backend responses, OpenAPI, and tests.
  Do not rely on local casts around a narrower shared union.
- OpenAPI should be a real contract, not only path summaries. Include auth
  scheme, request bodies, response schemas, error responses, and the delegation
  status enum.
- Useful verification after these fixes: backend tests, backend build,
  frontend typecheck/build, root format/build, and an optional browser smoke.

## Deep Audit Follow-Up Fixes

The audit findings were addressed with focused, test-backed changes.

- Delegation acceptance now verifies delegation identity before activation and
  storage. The backend rejects cross-user delegations and delegations targeting
  a different backend DID.
- Notes uses an app-specific backend-owned KV prefix:
  `xyz.tinycloud.notes-backend`. This keeps `DelegationStore` records isolated
  from other apps even when they share the same backend private key. Keep this
  prefix slash-free; TinyCloud backend sign-in rejects `xyz.tinycloud.notes/backend`
  with `Incorrect Structure`.
- SQL/KV split writes are now retryable and do not silently drift. Updates write
  the body first and preserve old metadata/body on body-write failure. Deletes
  remove the body first and keep metadata if body deletion fails.
- `stale` is now a first-class delegation status in shared types, frontend state
  handling, OpenAPI, and backend contract tests.
- OpenAPI now includes bearer auth, note request/response schemas, reusable
  error responses, and delegation status schema coverage.
- Browser smoke should check for zero console errors. A small inline favicon is
  enough to avoid the otherwise noisy `/favicon.ico` 404 in the Notes shell.

# New TinyCloud App Architecture

Use this as the dependency-agnostic blueprint for building a new TinyCloud app.
It intentionally avoids references to existing scaffolds, named applications,
UI frameworks, source integrations, or repository-local file paths.

The durable contract is the architecture: the browser owns user consent, the
backend works only through delegated capability, and TinyCloud remains the data
and permission boundary.

## 1. Roles

Every backend-mediated app should keep these jobs separate:

- **Browser/client**: owns the user's identity session, TinyCloud sign-in,
  consent, source setup, direct user-owned writes, and sensitive secret writes.
- **Backend**: verifies user sessions, stores portable delegations keyed by the
  user's stable identity, activates delegated TinyCloud access, runs app jobs,
  and persists normalized app data through delegated access.
- **TinyCloud**: stores user-owned app data, stores secrets and grants, enforces
  capability boundaries, and stores backend-owned operational state only when
  the backend signs in as itself.
- **Optional worker or agent**: receives only explicitly delegated capability.
  It should be represented as another delegatee with its own DID and permission
  policy, not as an implicit extension of the backend.

A full TinyCloud app has up to three components, and **each has its own DID**:
the frontend, the backend, and the agent. TinyCloud is both the datastore and
the communication substrate — the components store data in TinyCloud and
communicate through shared TinyCloud spaces rather than bespoke channels.
Simpler apps are subsets of this shape: frontend-only, or frontend plus backend.

The frontend owns consent for the whole app. It asks the user, in one signature,
for every permission the app needs — its own, plus the subset the backend
requests and the subset the agent requests. It then delegates the
backend-requested subset to the backend's DID and the agent-requested subset to
the agent's DID. This single-consent fan-out is why the backend and agent each
need a stable DID: a delegation is bound to the specific delegatee identity.

In the blessed deployment, the backend runs inside a TEE (Phala Cloud CVM) so it
is verifiable — attestation proves the backend runs the software it claims to,
which is what lets a user trust a component that holds delegated access to their
data. The agent runs on the TinyCloud agent service. See `DEPLOYMENT.md` for how
these targets are configured.

Do not let backend data routes rely on wallet credentials, raw private keys, or
frontend-local state. The backend operates on user data only through a portable
delegation the user signs.

## UI Surface Contract

New TinyCloud apps should open directly into the usable product surface, not a
landing page, implementation dashboard, or protocol demo. Keep the default
visual language minimal and operational:

- Use a quiet app shell: neutral gray page background, white work surfaces,
  subtle gray borders, compact spacing, system sans typography, and corners no
  larger than 8px unless the app has a deliberate product-specific system.
- Make the header do only durable app work: product name, account/sign-in
  action, and optional compact utility controls.
- Keep sign-in clean. The primary unauthenticated affordance should be a single
  sign-in button in the header. Hide unavailable secondary account actions
  instead of showing disabled clutter.
- Keep connection, delegation, policy hash, DID, address, and provider details
  out of the main canvas. Put them in a header-adjacent disclosure such as
  `Connection details`, and surface errors there unless the error blocks the
  main workflow.
- Do not add fake navigation, tabs, section bars, hero copy, decorative
  backgrounds, onboarding prose, or implementation explainer panels. Add
  navigation only when there are real routes or modes a user can switch between.
- Make the main canvas about the app's job. A blank starter should show the
  smallest useful probe/work surface. A product example should show its core
  list/create/edit flow directly.
- Treat loading as part of the product surface. During boot, session restore,
  backend policy fetches, delegation checks, list/detail fetches, saves, and
  deletes, show compact readiness/status surfaces in the affected region. Do
  not render empty states, editable forms, or enabled work controls until the
  app has enough data and authority for that surface to be true.
- Avoid visual assets in the starter unless the specific app domain requires
  them. The starter and generic examples should feel like clean tools, not
  marketing pages.
- Keep browser-shell smoke tests aligned with this contract: the shell should
  render without console errors, use a plain page background, avoid fake nav,
  keep connection details outside the main content, and cover at least one
  restored-session or delayed-backend loading path that must not look like an
  empty ready state.

## 2. Sign-In And Delegation

The default boot order is:

1. Connect the user's identity or wallet provider.
2. Request an app backend nonce for the connected address or primary DID.
3. Fetch unauthenticated backend policy from `/api/server-info`.
4. Fetch the runtime app manifest from `/api/manifest`.
5. Convert backend or worker policy into delegate manifests, then compose those
   manifests with the app manifest.
6. Create the TinyCloud user session with the backend nonce, auto-create the app
   space when appropriate, and include the composed capability request.
7. Verify the signed user session with the backend and store only the backend
   session token in app session storage.
8. Check `/api/delegations/status`.
9. If the delegation is missing, expired, or stale, create a manifest-backed
   portable delegation and post it to `/api/delegations`.
10. Enable delegated backend routes only after the backend reports active
    delegated access.

A restored backend session token can be enough for backend-mediated reads when
delegation is still active. It is not enough to create a new delegation, expand
permissions, or share a secret. Those states must ask the user to reconnect the
identity or wallet provider.

## 3. Backend Policy Contract

In this architecture, `/api/server-info` is the backend's advertised delegation
policy endpoint. It should return:

- `did`: backend DID
- `status`: readiness state
- `name`: user-facing delegate name
- `expiry`: suggested delegation lifetime
- `policyHash`: stable hash of the resolved backend delegation policy. This is
  required for every backend, worker, or agent that participates in delegation.
- `permissions`: app-relative permissions with `service`, `path`, `actions`,
  optional `space`, optional `skipPrefix`, and a useful `description`
- `features`: optional availability flags for environment-dependent features

The backend must derive its requested permissions from code, validate that they
are a subset of the runtime manifest, resolve app-relative paths before
comparing capabilities, and hash the resolved policy. Store that policy hash
with every accepted delegation. Non-delegating health or discovery endpoints may
omit `policyHash`; delegation backends must not.

Policy coverage is necessary but not sufficient. Any accepted delegation must
also bind to the authenticated user identity and to the current backend or
worker DID. Do not store a delegation under the current backend session merely
because its resources cover the requested policy.

If the policy hash changes, the stored delegation is stale. The delegation
status route and delegation middleware must evict the old record and return a
state that causes the browser to re-sign before delegated routes run again. Do
not keep using stale delegations after requested paths, actions, spaces, or
service permissions change.

## 4. Runtime Manifest Contract

`/api/manifest` should return the runtime app manifest. Keep the manifest as the
user-facing capability surface for the app's own data. Add delegate-specific
grant paths at runtime only when they depend on the current backend or worker
DID.

Do not encode backend delegation policy in legacy or implementation-specific
manifest fields. Compose delegations from app code by turning delegatee policy
into manifests and passing those manifests to the SDK composer.

Permission descriptions should be precise enough for a user or agent to
understand why each capability is requested. Descriptions are explanatory; they
do not expand capability.

### Manifest Creation Checklist

Create a v1 JSON manifest as the app's user-facing capability contract. Serve
the runtime form from `/api/manifest`.

Include these required top-level fields:

- `app_id`: stable app identifier and default storage path prefix. Choose this
  before users create data; changing it later is a migration.
- `name`: user-facing app name.

Use optional top-level fields deliberately:

- `manifest_version`: use `1`; if omitted, version `1` is assumed.
- `description`: short explanation of what the app does and what its data
  represents.
- `space`: default TinyCloud space for manifest permissions. If omitted,
  `applications` is assumed.
- `prefix`: default path prefix. If omitted, `app_id` is used; an empty string
  disables prefixing.
- `defaults`: set deliberately. When true or omitted, the app requests built-in
  app-scoped defaults. When false, only explicit permissions are requested.
- `expiry`: default capability expiry.
- `permissions`: explicit capabilities beyond the defaults.
- `includePublicSpace`: include public-space companion behavior. If omitted, it
  is enabled.
- `did`: only for a manifest that is itself a delegation target.

A permission entry should contain:

- `service`: TinyCloud service name.
- `path`: app-relative path by default.
- `actions`: requested actions for that service.
- `description`: why this specific capability is needed.

Use optional permission fields when needed:

- `space`: override the manifest's default space for one permission.
- `skipPrefix`: set to true only when the path is already absolute for that
  service's capability grouping.
- `expiry`: override the manifest expiry for one permission.

By default, permission paths are resolved under the manifest prefix. Keep paths
app-relative unless the service requires an already-resolved path, then mark
that permission with `skipPrefix: true`. Actions may use service-specific short
names if the manifest resolver expands them for that service.

The standard default tier includes app-scoped KV read/write/list/metadata
capabilities, app-scoped SQL read/write capabilities, and app-scoped
capability-read access. Higher tiers may exist, but a new app should prefer
`defaults: false` plus explicit permissions when it needs a small or easily
audited grant surface.

When composing manifests, expect the composer to validate v1 manifests, expand
defaults and explicit permissions, apply prefixing, default missing spaces,
dedupe equivalent permissions, record delegation targets for manifests with
`did`, and produce one capability request for one user signature. If multiple
manifests use the same `app_id`, their permissions merge under the same app id
scope; different `app_id` values preserve distinct app id scopes. Account
registry permissions may be included by default so signed-in apps can be
discoverable later; disable that only when the product explicitly does not want
registry writes.

Use the SDK manifest helpers for app code: load and validate manifests before
composition, resolve manifests when comparing concrete capability surfaces, and
compose all app and delegatee manifests into one capability request before
sign-in. If both a single manifest and a composed capability request are passed
to the sign-in client, the composed request is the authority.

Keep delegate-specific policy out of the app manifest. Backend, worker, or
agent permissions should be advertised by `/api/server-info` and composed with
the app manifest during sign-in. Do not add legacy `backend` or `delegations`
sections to a v1 manifest.

If the app chooses to serve a runtime manifest and a permission depends on a
runtime DID or another runtime value, append only that permission in the
`/api/manifest` response. The source manifest should remain the stable app and
data contract.

Before accepting delegated access, resolve the backend or worker policy against
the runtime manifest, verify it is covered by the manifest-granted
capabilities, and store a hash of the resolved policy with the delegation. If
that hash changes, require a fresh user signature.

## 5. Delegation Handling

`POST /api/delegations` should:

1. Require a verified backend session.
2. Accept a serialized portable delegation or supported delegation bundle.
3. Deserialize it.
4. Extract the delegation identity metadata needed to compare the delegator or
   owner against the authenticated backend session's stable user identity.
5. Verify the delegatee is the current backend, worker, or agent DID.
6. Extract resources and normalize service, space, path, and action names.
7. Verify that granted resources cover the current resolved backend policy and
   record the current policy hash.
8. Activate the delegation against TinyCloud before storing it.
9. Persist the serialized delegation, expiry, resolved resources, and policy
   hash keyed by the user's stable identity.
10. Cache active delegated access for the request path.

If the serialized form cannot expose enough identity metadata to verify both
the user and delegatee binding, treat that as a blocker for accepting the
delegation. Do not activate and store an unbound delegation as a fallback.

For a multi-resource delegation bundle, activate each resource as needed and
combine only the delegated handle for the service that resource grants. Avoid
blindly copying every handle exposed by an SDK access object, because a handle
for one active resource can overwrite a correctly scoped handle for another
service.

`GET /api/delegations/status` should return at least `none`, `expired`, `stale`,
or `active`. If the stored policy hash is stale, remove the delegation and return
`stale` or another documented state that causes the client to request a fresh
signature. Make stale-policy behavior first-class in shared types, frontend
state, OpenAPI or equivalent contracts, and tests.

Delegation middleware should run after backend session authentication. It should
load active delegated access from cache when valid, re-activate from persistent
storage on cache miss, evict expired or stale-policy records, and attach only
the delegated TinyCloud access needed by downstream routes.

## 6. Storage Boundaries

Choose a stable app id before users create data. Recommended format:

```text
xyz.tinycloud.<app-name>
```

Changing the app id after users have data is a migration, not a rename.

Name user-owned data under the app id:

- KV prefixes: `xyz.tinycloud.<app>/<model>/...`
- SQL databases: `xyz.tinycloud.<app>/<database>`
- DuckDB databases: `xyz.tinycloud.<app>/<database>`
- Hook paths: resolved from the same manifest paths

TinyCloud KV reads may return JSON documents either as the raw string that was
written or as an already-parsed object, depending on the SDK path and content
handling. Any storage helper that writes structured JSON should decode both
shapes. Add a regression test that writes a record, then lists or reads it
through a mock KV implementation that returns parsed JSON, so a successful
create cannot be followed by an empty list.

For named SQL or DuckDB databases, treat the fully resolved database identifier
as part of the storage contract. Always open the database through an explicit
helper that receives the resolved identifier, and make every route use that
helper instead of a default query or execute shortcut. Do not assume two paths
are isolated merely because their prefixes differ; if the storage layer
normalizes or aliases by database name or final path segment, colliding suffixes
can point at the same physical store. Choose globally distinct database names,
resolve them from the manifest and policy layer, and test that reads and writes
hit the intended store.

Backend-owned TinyCloud storage is only for backend state such as delegation
records, operational queues, webhook bookkeeping, or failed job records. Do not
mix backend-owned state with the user's app data.

Backend-owned state must also be isolated per app. If multiple apps or examples
can run with the same backend private key, do not share a default backend KV
prefix or unqualified keys such as `delegations/{user}` across apps. Use an
app-specific operational prefix or include the app id in every backend-owned
record key. Validate that the prefix is accepted by backend sign-in; some
backend-owned prefixes may need a different shape from user-owned app data
paths.

For models split across SQL metadata and KV bodies, design partial-failure
semantics deliberately. Prefer writing the KV body before creating SQL metadata,
cleaning up the body if metadata creation fails. On update, avoid changing SQL
metadata if a body write fails; if metadata fails after a body write, restore or
otherwise reconcile the prior body. On delete, avoid deleting metadata before
the body delete succeeds, or record deterministic cleanup work. Tests should
cover partial failures so SQL rows and KV bodies do not silently drift.

When an external account connection completes through a backend callback, keep
the same ownership boundary. The callback may exchange a one-time code and use
the user's stored delegation to write provider tokens or connection config into
the user's app-scoped TinyCloud storage. Protect the callback with single-use
state, require an active delegation before writing, and store backend
subscriptions or delivery bookkeeping separately in backend-owned operational
storage.

For long-running imports, syncs, webhook deliveries, or background jobs, design
an explicit recovery loop. Stream progress events for interactive runs, make
every write idempotent with a stable external or content-derived key, and treat
missing delegation, expired credentials, unavailable grants, or temporarily
lapsed subscriptions as recoverable states rather than silent drops. Store
pending and failed job records in backend-owned operational storage with enough
metadata to replay or diagnose them, expose authenticated replay and clear
endpoints, and have the client check those endpoints after sign-in or reconnect
so queued work can resume and the UI can refresh once replay completes.

## 7. Secrets Boundary

Secrets are never posted to the backend as raw values. Use this flow:

1. Browser unlocks TinyCloud Secrets.
2. Browser writes the secret directly to TinyCloud.
3. Browser ensures backend delegation is active.
4. Browser shares or re-encrypts the secret for the backend DID.
5. Backend reads the secret only through delegated Secrets access after the
   grant exists.

If the backend cannot read a shared secret, surface a "finish access" or
"reconnect" state. Do not silently fall back to storing secrets in app KV, SQL,
environment variables, logs, or backend request bodies.

Backend delegated secret writes and deletes should be unsupported unless the
product has an explicit reason and a separate consent flow.

## 8. Product State Model

Gate the app on explicit states:

- unauthenticated
- signing in
- backend session restored without a live user wallet or identity provider
- checking delegation
- delegation missing, expired, or stale
- no user data or source connected yet
- user credential exists but backend grant is missing
- ready state
- import, sync, or background job pending
- recoverable error requiring reconnect or re-consent

Avoid treating restored backend sessions as fully interactive wallet sessions.
If the app needs a fresh signature, expanded permissions, or a new secret grant,
ask the user to reconnect.

## 9. Domain Model Replacement

When building a product, replace placeholder domain concepts in this order:

1. Define shared types and API contracts for the product model.
2. Define the app's storage paths, database names, table names, and migration
   or schema initialization strategy.
3. Update the runtime manifest and backend policy so they cover only the
   required storage surfaces.
4. Implement backend routes behind session authentication and delegation
   middleware.
5. Implement browser views and direct TinyCloud access only where direct user
   ownership is part of the product experience.
6. Update OpenAPI or equivalent API documentation if the app exposes HTTP
   routes. Treat it as a contract: include auth schemes, request bodies,
   response schemas, reusable error responses, and state enums such as
   delegation status.
7. Add tests for policy shape, delegation status, stale-policy invalidation,
   user/delegatee binding, storage helpers, partial SQL/KV failures, and at
   least one happy-path product workflow.

Keep auth, session, delegation, CSRF, and API-client flow intact unless the
product has a specific reason to change it.

## 10. Verification

Before treating a scaffold as ready:

- install dependencies with the repository's locked install mode
- run formatting and type checks
- run unit tests for shared client/server packages
- run backend route tests for auth, delegation, policy, and storage behavior
- run API contract tests when an OpenAPI or similar spec exists
- run a browser smoke test such as `bun run test:browser:app-shell` that avoids
  real credentials, covers app-shell rendering, and checks for unexpected console
  errors
- run an opt-in real identity-provider/TinyCloud pass only when credentials and
  an operator-owned test account are available

Do not require production credentials, real secrets, or live third-party source
accounts for the default CI path.

For local identity-provider or passkey checks, use HTTP localhost when the
identity flow supports it; otherwise use trusted HTTPS. Never use HTTPS with a
browser certificate warning for WebAuthn. A browser that has clicked through a
certificate warning may still block WebAuthn or surface misleading network
errors.

Searchable error:
`WebAuthn is not supported on sites with TLS certificate errors`.

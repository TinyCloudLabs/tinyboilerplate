# TinyBoilerplate AI Project Guide

This repository is the TinyCloud app-creation substrate. It contains shared
packages, a reusable blank starter, a real Notes example, and a scaffold CLI
that materializes standalone TinyCloud apps.

## Canonical Sources

Use these files first when creating or evaluating a new app:

- `README.md` - human-facing setup, scaffold, verification, and runtime notes
- `docs/new-app.md` - architecture contract for app creation
- `docs/tinycloud-example-app-skill-notes.md` - skill-source notes distilled
  from app-starter and Notes
- `templates/app-starter` - canonical blank starter source
- `examples/notes` - first real product example

## Current App-Creation Flow

Create user-facing apps through the scaffold CLI:

```bash
bun run scaffold:app -- \
  --out ../scratch-app \
  --app-id xyz.tinycloud.scratch \
  --app-name "Scratch TinyCloud App" \
  --backend-prefix ops.scratch.backend \
  --frontend-port 5185 \
  --backend-port 3013
```

The scaffold copies `templates/app-starter`, `packages/core`,
`packages/client`, `packages/server`, root workspace config, and hidden env
examples. It must not copy generated artifacts such as `dist`, `.turbo`,
`node_modules`, or `*.tsbuildinfo`.

Generated apps are intended to install, build, and test outside this monorepo:

```bash
bun install
bun run generate-key
bun run build
bun run test
```

## Workspace Map

```text
packages/core              shared types and constants
packages/client            browser helpers for OpenKey, TinyCloud sign-in,
                           manifest composition, delegation, and API calls
packages/server            backend identity, session refresh, delegation store,
                           and delegation cache helpers
packages/agent-runtime     agent/container runtime support
templates/app-starter      canonical blank reusable starter
examples/notes             canonical first real app example
```

Root commands:

```bash
bun install
bun run build
bun run dev:app-starter
bun run dev:notes
bun run scaffold:app -- --help
bun test scripts/scaffold-app.test.ts
bun run test:scaffold:integration
bun run test:browser:app-shell
```

`bun run dev` should point at the current blank starter. Use explicit
`dev:notes` or `dev:app-starter` when documenting workflows.

## Architecture Contract

- Use **space**, not namespace or orbit, for TinyCloud user data containers.
- The browser signs in the user with OpenKey/TinyCloud and obtains a
  user-owned delegation to the backend.
- The backend has its own operational identity and TinyCloud space. Its
  operational KV prefix must be slash- and backslash-free.
- User app data remains app-scoped under the app id.
- Delegations must be bound to the authenticated user and the expected backend
  delegatee DID.
- `/api/server-info` exposes a coherent backend policy: DID, name, expiry,
  permissions, and `policyHash`.
- Policy changes invalidate stale stored delegations. `stale` is a first-class
  delegation status alongside `active`, `expired`, and `none`.
- OpenAPI must describe implemented behavior, including `server-info`,
  delegation status, and app data routes.
- SQL/KV split writes need explicit partial-failure or compensation behavior.
- Local WebAuthn/OpenKey verification needs HTTP localhost or trusted HTTPS.
  HTTPS with a browser certificate warning can fail with:
  `WebAuthn is not supported on sites with TLS certificate errors`.

## Package Types To Expect

`@tinyboilerplate/core` includes shared app/delegation/server types such as:

- `DelegationStatus = "active" | "expired" | "none" | "stale"`
- `StoredDelegation` with serialized delegation metadata, resources, and
  optional `policyHash`
- `ServerInfo` for non-delegating servers
- `DelegatingServerInfo` for backends that require a hashable policy and
  explicit permissions

`@tinyboilerplate/client` owns browser-side helpers for:

- OpenKey provider setup
- TinyCloudWeb creation and sign-in
- app manifest loading and validation
- manifest/backend policy composition
- backend delegation creation, send, status, and revoke calls
- bearer-token API requests

`@tinyboilerplate/server` owns backend-side helpers for:

- backend TinyCloud identity creation with an explicit operational prefix
- session refresh
- backend-owned delegation persistence
- in-memory delegation cache

## Verification Expectations

Minimum hygiene before trusting app-creation changes:

```bash
bun install --frozen-lockfile
bun run format:check
bun run build
bun test scripts/scaffold-app.test.ts
bun run test:scaffold:integration
bun test templates/app-starter/backend/src
bun test examples/notes/backend/src
bun run test:browser:app-shell
git diff --check
```

These checks are smoke and contract checks. They do not replace a real browser
sign-in, WebAuthn/OpenKey, TinyCloud space creation, or browser-to-backend
delegation grant.

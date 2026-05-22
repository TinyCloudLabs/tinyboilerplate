# TinyCloud App Starter

Reusable TinyCloud app substrate with OpenKey browser identity, backend SIWE
session verification, manifest-backed backend delegation, stale-policy
invalidation, and one delegated KV probe.

Template defaults are:

- App id: `xyz.tinycloud.app-starter`
- App name: `TinyCloud App Starter`
- Backend operational prefix: `xyz.tinycloud.app-starter-backend`
- Frontend package: `@tinyboilerplate/app-starter-frontend`
- Backend package: `@tinyboilerplate/app-starter-backend`

## Local TLS

OpenKey/passkey checks may use HTTP localhost when the identity flow supports
it; otherwise use trusted HTTPS. If the browser shows a TLS certificate warning,
WebAuthn can fail even after clicking through the interstitial. Do not debug
auth or delegation flows on a warning page.

Searchable error:
`WebAuthn is not supported on sites with TLS certificate errors`.

If `frontend/localhost.pem` and `frontend/localhost-key.pem` exist, both dev
servers use the trusted local certificate:

- frontend: `https://localhost:5175`
- backend: `https://localhost:3003`

Without those files, both servers fall back to HTTP.

Generate local certs with:

```bash
mkcert -install
mkcert -key-file frontend/localhost-key.pem -cert-file frontend/localhost.pem localhost 127.0.0.1 ::1
```

## Run

Create a backend env file:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Then set `BACKEND_PRIVATE_KEY` in `backend/.env` or your shell and run from the
repo root:

```bash
bun run dev:app-starter
```

Default local URLs:

- frontend: `http://localhost:5175`
- backend: `http://localhost:3003`

When trusted local certs exist, both switch to HTTPS on the same ports. Leave
`frontend/.env` without `VITE_BACKEND_URL` unless you need an explicit backend
override; the frontend derives `http` or `https` from the page protocol.

## Verification

Use build and backend tests as unauthenticated smoke checks:

```bash
bun run build
bun test templates/app-starter/backend/src
```

Those checks do not exercise OpenKey, WebAuthn, TinyCloud space setup, or the
browser delegation grant. From the repo root, use the real-auth fixture when you
need scripted coverage of the actual identity and delegation flow:

```bash
bun run test:real-auth:setup
bun run test:real-auth
```

The setup command is interactive and saves Playwright browser auth state for
replay. It launches installed Chrome when available so platform passkeys behave
like a normal browser. If it asks for an external security key or says to insert
a key, rerun with:

```bash
REAL_AUTH_BROWSER=chrome REAL_AUTH_USER_DATA_DIR=.auth/chrome-profile bun run test:real-auth:setup
```

When using trusted mkcert HTTPS, Bun's backend polling may also need the mkcert
root CA. The real-auth commands auto-detect local mkcert certs when possible;
if your shell cannot find `mkcert`, run with the CA path explicitly:

```bash
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" FRONTEND_URL=https://localhost:5175 BACKEND_URL=https://localhost:3003 REAL_AUTH_BROWSER=chrome REAL_AUTH_USER_DATA_DIR=.auth/chrome-profile bun run test:real-auth:setup
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" FRONTEND_URL=https://localhost:5175 BACKEND_URL=https://localhost:3003 REAL_AUTH_IGNORE_HTTPS_ERRORS=1 bun run test:real-auth
```

Treat saved auth state as credential material: use a disposable test identity,
keep the delegation short-lived, keep `.auth/`, traces, videos, and screenshots
local-only, and re-run setup when the state expires or the backend policy is stale.

For manual runtime verification, start the app, sign in in a browser, grant the
backend policy, then read and update the probe. Use HTTP localhost when
supported by the identity flow, or a trusted HTTPS localhost certificate. Do not
treat a browser TLS warning page as a valid passkey test environment.

## Scaffolding From This Template

This directory is the canonical app-starter source inside `tinyboilerplate`.
For a user-facing or skill-created app, run the scaffold command from the repo
root instead of raw-copying this directory:

```bash
bun run scaffold:app -- --out ../scratch-app --app-id xyz.tinycloud.scratch --app-name "Scratch TinyCloud App" --backend-prefix xyz.tinycloud.scratch-backend --frontend-package @scratch/tinycloud-frontend --backend-package @scratch/tinycloud-backend --frontend-port 5185 --backend-port 3013
```

Raw template copy is useful for internal maintenance, but it is not a standalone
app by itself. The frontend and backend depend on repo-local workspace packages
through `workspace:*`, and their `tsconfig.json` files expect the source repo
layout. The scaffold copies the template plus `packages/core`, `packages/client`,
`packages/server`, root `package.json`, `tsconfig.base.json`, `turbo.json`, and
`.gitignore`.

The scaffold copy/replacement pass should exclude generated artifacts:
`dist`, `.turbo`, `node_modules`, and `*.tsbuildinfo`. It must include hidden
files, for example by using a hidden-file-aware walker or `rg -uu`, so
`frontend/.env.example` and `backend/.env.example` are copied and renamed with
the rest of the app metadata.

Scaffolded apps keep `@tinyboilerplate/*` as the internal substrate package
scope. Product/user-facing identity should be the generated app name across
the manifest, OpenKey app name, HTML title, OpenAPI, and backend delegation
policy.

After scaffolding:

```bash
cd ../scratch-app
bun install
bun run generate-key
bun run build
cp frontend/.env.example frontend/.env
# If backend/.env already existed, replace BACKEND_PRIVATE_KEY with the printed key.
bun run test
bun run dev
```

The only app data route is the storage probe:

- `GET /api/probe`
- `PUT /api/probe` with `{ "value": "..." }`
- `DELETE /api/probe`

## Operational Notes

Probe delete is intentionally idempotent. The TinyCloud KV delete path can
return a successful empty/no-content response that the current SDK reports as
`Error parsing XML: no root element`. The starter treats that exact parse error
as a completed delete while still surfacing real storage, auth, and policy
errors.

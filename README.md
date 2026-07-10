# TinyBoilerplate

Full-stack starter substrate for [TinyCloud](https://tinycloud.xyz) +
[OpenKey](https://openkey.so), plus product examples that show the substrate in
use.

## What to Start From

Use `docs/app-architecture.md` as the durable app-creation contract. It defines
the browser, backend, delegation, manifest, OpenAPI, and storage boundaries that
new apps should preserve.

`templates/app-starter` is the canonical blank TinyCloud app source inside this
repo. For a user-facing or skill-generated app, use the scaffold command rather
than copying the template directly. The scaffold materializes the template with
new ids, package names, ports, env examples, and standalone workspace files.

Use `examples/notes` as the first real product example. It builds on the same
delegation contract with an app-specific Notes domain, backend-owned operational
state, and a user-data model worth copying when you need more than the blank
probe.

Use `examples/tasks` when your app writes storage **directly from the browser**
(`tcw.sql`) instead of through a delegating backend. It is a small SQL task list
that consumes the reusable browser-direct guardrails in `@tinyboilerplate/client`
(`createSchemaEnsurer`, `createMutationGuard`, `createDidKeyedCache`) and its
manifest grants `tinycloud.sql` the `schema` action because it issues its own DDL.
See `docs/app-architecture.md` for when to pick delegated-backend vs browser-direct.

## UI Style

TinyCloud starter and example apps should feel like clean operational tools.
Open directly into the product surface: a compact header, a single clear
sign-in action, and the app's create/list/edit work in the main canvas. Keep
connection diagnostics, delegation status, DIDs, addresses, and policy hashes
inside a small header disclosure instead of a prominent page panel.

Use a restrained dashboard baseline: neutral gray page background, white
surfaces, subtle gray borders, system sans typography, compact spacing, and
8px-or-smaller radius. Do not add fake nav bars, hero sections, decorative
backgrounds, or protocol explainer panels unless the app has real routes or a
specific product reason.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/tinycloudlabs/tinyboilerplate.git
cd tinyboilerplate
bun install

# 2. Build packages
bun run build

# 3. Generate or provide a backend private key for the app-starter backend
bun run generate-key

# 4. Configure the blank starter
cp templates/app-starter/frontend/.env.example templates/app-starter/frontend/.env
# If templates/app-starter/backend/.env already existed, the generator printed a
# key instead of overwriting it. Paste that value into BACKEND_PRIVATE_KEY.

# 5. Run the blank starter
bun run dev:app-starter
```

The app-starter frontend runs on `http://localhost:5175` by default. The
app-starter backend runs on `http://localhost:3003`. If trusted local certs exist
at `templates/app-starter/frontend/localhost.pem` and
`templates/app-starter/frontend/localhost-key.pem`, both dev servers switch to
HTTPS on the same ports.

To run Notes instead:

```bash
bun run packages/server/scripts/generate-key.ts examples/notes/backend/.env
cp examples/notes/frontend/.env.example examples/notes/frontend/.env
# If examples/notes/backend/.env already existed, replace BACKEND_PRIVATE_KEY
# with the printed key.
bun run dev:notes
```

Notes uses `http://localhost:5174` for the frontend and `http://localhost:3002`
for the backend, with HTTPS on those same ports when trusted local certs are
present.

To run the browser-direct Tasks example instead:

```bash
cp examples/tasks/frontend/.env.example examples/tasks/frontend/.env
bun run dev:tasks
```

Tasks is frontend-only (it writes to `tcw.sql` directly from the browser, so it
has no backend) and runs on `http://localhost:5176`.

## Scaffold a Standalone App

Use the scaffold pipeline when creating an app outside this repo:

```bash
bun run scaffold:app -- --out ../scratch-app --app-id xyz.tinycloud.scratch --app-name "Scratch TinyCloud App" --backend-prefix xyz.tinycloud.scratch-backend --frontend-package @scratch/tinycloud-frontend --backend-package @scratch/tinycloud-backend --frontend-port 5185 --backend-port 3013
```

A scaffolded app is standalone. In addition to `templates/app-starter`, it copies
the shared workspace packages and root config the starter needs:

- `packages/core`
- `packages/client`
- `packages/server`
- root `package.json`
- `tsconfig.base.json`
- `turbo.json`
- `.gitignore`

Raw template copy alone is not standalone: the template package manifests use
`workspace:*` dependencies, and the TypeScript configs assume the source repo's
workspace layout. The scaffold should also exclude generated artifacts
(`dist`, `.turbo`, `node_modules`, `*.tsbuildinfo`) and use a hidden-file-aware
walker or `rg -uu` so hidden files such as `.env.example` are included in the
copy, rename, and replacement pass.

Generated apps intentionally keep the copied shared packages under the
`@tinyboilerplate/*` internal substrate package scope. User-facing identity must come
from the generated app name in the manifest, OpenKey configuration, HTML title,
OpenAPI, and backend policy surfaces.

Verify the in-repo starter with:

```bash
bun install --frozen-lockfile
bun run format:check
bun run build
bun test templates/app-starter/backend/src
bun run test:scaffold:integration
bun run test:browser:app-shell
```

Verify a scratch scaffold with:

```bash
cd ../scratch-app
bun install
bun run generate-key
bun run build
bun run test
cp frontend/.env.example frontend/.env
# If backend/.env already existed, replace BACKEND_PRIVATE_KEY with the printed key.
bun run dev
```

Build and backend tests are unauthenticated smoke checks. They verify that the
generated workspace compiles, the OpenAPI/server-info surfaces are coherent, and
the backend route tests pass. They do not prove that OpenKey sign-in, WebAuthn,
TinyCloud space creation, or browser-to-backend delegation works end to end.
`bun run test:browser:app-shell` is also unauthenticated; it renders the starter
and Notes frontend shells with mocked-away backend use and checks for browser
console errors.

The real-auth command is the scripted path for exercising the actual
OpenKey/WebAuthn/TinyCloud login and backend delegation flow with a human
present:

```bash
bun run test:real-auth
```

Playwright opens a headed browser, you complete OpenKey/WebAuthn sign-in and
grant the backend delegation normally, and Playwright keeps using that same live
browser session to update and verify the starter probe. This is not an auth
bypass.

The command launches installed Chrome when available so platform passkeys behave
like a normal browser. If the prompt still asks for an external security key or
says to insert a key, rerun with an explicit browser/profile:

```bash
REAL_AUTH_BROWSER=chrome REAL_AUTH_USER_DATA_DIR=.auth/chrome-profile bun run test:real-auth
```

When using trusted mkcert HTTPS, Bun's backend polling may also need the mkcert
root CA. The real-auth command auto-detects local mkcert certs when possible;
it only auto-switches to HTTPS when the mkcert root CA is available. If your
shell cannot find `mkcert`, run with the CA path explicitly:

```bash
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" FRONTEND_URL=https://localhost:5175 BACKEND_URL=https://localhost:3003 REAL_AUTH_BROWSER=chrome REAL_AUTH_USER_DATA_DIR=.auth/chrome-profile bun run test:real-auth
```

Do not commit `.auth/`, browser traces, videos, screenshots, or similar
Playwright output. Use a disposable test identity and keep the delegation
short-lived.

For a manual real runtime verification, open the running app in a browser and
complete the OpenKey/TinyCloud flow:

- Starter or scaffolded app: sign in, grant the backend delegation, then read
  and update the probe.
- Notes: sign in, grant the backend delegation, then create, edit, list, and
  delete a note.

OpenKey/passkey checks may use HTTP localhost when the identity flow supports
it; otherwise use trusted HTTPS. Never use HTTPS with a browser certificate
warning for WebAuthn. It can fail with `WebAuthn is not supported on sites with
TLS certificate errors` even after you click through the warning page.

## Project Structure

```text
tinyboilerplate/
├── packages/
│   ├── core/                        # Shared types and constants
│   ├── client/                      # Browser helpers for auth/delegation/API calls
│   └── server/                      # Server helpers for identity/delegations/sessions
├── templates/
│   └── app-starter/                 # Blank reusable TinyCloud app starter
│       ├── frontend/                # React + Vite, port 5175
│       └── backend/                 # Express + Bun, port 3003
├── examples/
│   └── notes/                       # First real product example
│       ├── frontend/                # React + Vite, port 5174
│       └── backend/                 # Express + Bun, port 3002
├── package.json                     # Bun workspace root
└── tsconfig.base.json
```

## Packages

### `@tinyboilerplate/core`

Shared types and constants used by both client and server.

- `DelegationInfo`, `StoredDelegation`, `ServerInfo` - delegation/server types
- `DEFAULT_DELEGATION_EXPIRY_MS`, `DELEGATION_CACHE_TTL_MS` - delegation lifetime constants

### `@tinyboilerplate/client`

Framework-agnostic browser helpers.

| Export | Description |
|--------|-------------|
| `createOpenKey(config?)` | Create an OpenKey instance |
| `connectWallet(openkey)` | Connect wallet, return EIP-1193 provider |
| `createTinyCloudWeb(provider, config?)` | Create TinyCloudWeb instance |
| `signIn(tcw)` | Sign into TinyCloud, sets `tcw.did` and `tcw.spaceId` |
| `loadAppManifest(url)` | Load and validate a manifest |
| `composeManifestWithBackend(manifest, serverInfo)` | Compose the app manifest with backend-requested delegation permissions |
| `createManifestDelegation(tcw, backendDID, capabilityRequest)` | Materialize a manifest-declared delegation to backend |
| `sendDelegation(url, serialized, token)` | POST delegation to backend |
| `checkDelegationStatus(url, token)` | Check if backend has active delegation |
| `revokeDelegation(url, token)` | Revoke backend's delegation |
| `TokenStore` | In-memory session token storage |
| `createApiClient(url, tokenStore, config?)` | Fetch wrapper with Bearer auth + 401 retry |

### `@tinyboilerplate/server`

Framework-agnostic Node.js/Bun helpers.

| Export | Description |
|--------|-------------|
| `createBackendIdentity(config)` | Initialize TinyCloudNode, sign in, return `{ node, did }` |
| `withSessionRefresh(node, fn)` | Retry on session expiry |
| `DelegationStore` | Persist delegations in backend-owned TinyCloud KV |
| `DelegationCache` | In-memory cache for `DelegatedAccess` |

## How It Works

### 1. User Connects Browser Identity

```text
Frontend                    OpenKey
   │── connect() ─────────────►│
   │◄── EIP-1193 provider ─────│
```

The EIP-1193 provider enables TinyCloud signing and backend session proof.

### 2. Frontend Signs Into TinyCloud

```typescript
const tcw = createTinyCloudWeb(wallet.provider);
await signIn(tcw);
// tcw.did -> user's primary DID (did:pkh:eip155:...)
// tcw.spaceId -> user's space ID
```

### 3. Frontend Delegates Access To Backend

```text
Frontend                    Backend                    TinyCloud
   │── GET /api/server-info ──►│                           │
   │◄── { did, policyHash } ───│                           │
   │                           │                           │
   │ materializeDelegation(backendDID)                     │
   │── POST /api/delegations ─►│                           │
   │                           │── store delegation ──────►│ (backend KV)
   │                           │── cache DelegatedAccess   │
   │◄── { status: "active" } ──│                           │
```

### 4. Backend Operates On User Data Via Delegation

```text
Frontend                    Backend                    TinyCloud
   │── GET /api/probe ────────►│                           │
   │                           │── kv.get("xyz.tinycloud.app-starter/probe/value") ─►│
   │◄── { probe } ─────────────│                           │
```

The delegation middleware resolves `DelegatedAccess` from cache or persistent
backend storage before any delegated data route.

## Building Your Own App

1. Scaffold from `templates/app-starter` using `bun run scaffold:app -- ...`.
2. Replace the probe route and UI with your app's model.
3. Use `examples/notes` as the reference for a real app-level data model,
   OpenAPI contract, and policy-staleness flow (delegated-backend pattern).
4. Use `examples/tasks` as the reference when you write storage directly from the
   browser (`tcw.sql`), reusing the `@tinyboilerplate/client` guardrails.

The delegation chain is the same regardless of your data model: connect
identity, sign into TinyCloud, delegate the backend policy, then operate on
TinyCloud via `DelegatedAccess`.

## Environment Variables

### App Starter Backend

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BACKEND_PRIVATE_KEY` | Yes | - | Ethereum private key (0x-prefixed). Generate with `bun run generate-key` |
| `TINYCLOUD_HOST` | No | `https://node.tinycloud.xyz` | TinyCloud node URL |
| `FRONTEND_URL` | No | Derived from cert mode, usually `http://localhost:5175` | Frontend origin allowed by backend CORS |
| `PORT` | No | `3003` | Backend port |

### App Starter Frontend

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_OPENKEY_HOST` | No | `https://openkey.so` | OpenKey host |
| `VITE_BACKEND_URL` | No | Derived from page protocol, usually `http://localhost:3003` | Backend URL override. Leave unset unless you need a custom or trusted-HTTPS backend origin |

## Known Constraints

- **Trusted local HTTPS for passkeys**: OpenKey/WebAuthn flows fail on pages with TLS certificate errors, even after clicking through the browser warning. Use HTTP fallback or trusted local certs.
- **Smoke vs. real auth**: `bun run build`, backend route tests, and scaffold
  smoke checks are useful hygiene, but they do not cover OpenKey/WebAuthn,
  TinyCloud space setup, or backend delegation. Use `bun run test:real-auth` for
  a local headed browser check where a human signs in and Playwright continues
  with that same browser session.
- **Wallet-mode session cap**: TinyCloud wallet-mode sessions expire after 1 hour. The `DelegationCache` uses a 50-minute TTL to stay under this cap.
- **WASM ESM fix**: `@tinycloud/node-sdk-wasm` ships CJS wrappers that break in ESM. The package postinstall patch keeps local builds working.
- **SDK version pins**: The root `overrides` pin the `@tinycloud` SDK to `2.5.1`, except `@tinycloud/sdk-services`, which is pinned to `2.4.2` — that is the latest published release on the `sdk-services` line (there is no `2.5.1`). These overrides are copied verbatim into every scaffolded app.
- **Delegation expiry**: App-starter delegations default to 7 days. After expiry or policy drift, the user must grant a new delegation from the frontend.
- **Backend identity**: The backend has its own TinyCloud space. Delegations are stored in backend-owned KV, not in the user's app data.

## License

MIT

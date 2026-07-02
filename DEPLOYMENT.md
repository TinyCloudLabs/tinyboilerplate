# Deploying a TinyCloud App

This guide takes a TinyCloud app from working locally to running in production.
It follows the blessed TinyCloud deployment shape:

- **Frontend** → Cloudflare Pages (static build).
- **Backend** → Phala Cloud CVM, a TEE (Trusted Execution Environment).
- **OpenKey** → the canonical public service at `https://openkey.so`.
- **TinyCloud** → the canonical hosted node (`https://node.tinycloud.xyz`, or the
  direct TEE endpoint `https://tee.node.tinycloud.xyz` for backend-to-node
  traffic).

For the architecture behind these choices, see `docs/app-architecture.md` and
the concept docs at <https://protocol.tinycloud.xyz>.

The commands below are grounded in a real deployed TinyCloud app. Where a step
requires an account, dashboard action, or DNS record you must create yourself,
it is marked **(account/dashboard step)**. Nothing in this guide fabricates a
turnkey command that does not exist; the app-starter ships with local dev and
CI, not with a wired-up production pipeline, so you build the small amount of
deploy plumbing described here.

---

## 1. Frontend → Cloudflare Pages

The frontend is a React + Vite app. `vite build` emits a static bundle to
`frontend/dist`, which Cloudflare Pages serves directly.

### Build

```bash
bun run build            # builds shared packages + the frontend
# or, just the frontend for a scaffolded standalone app:
cd frontend && bun run build
```

| Pages setting | Value |
| --- | --- |
| Build command | `bun install && bun run build` |
| Build output directory | `frontend/dist` |
| Root directory | repo root (a standalone scaffold) |

A `wrangler.toml` at the repo root records the Pages project name, the output
directory, and the frontend environment variables. Example, adapted from a real
TinyCloud app:

```toml
name = "my-tinycloud-app"
pages_build_output_dir = "frontend/dist"
compatibility_date = "2026-05-12"

[vars]
VITE_OPENKEY_HOST = "https://openkey.so"
VITE_BACKEND_URL = "https://api.my-app.example.com"
```

### Deploy

With `wrangler` installed and authenticated:

```bash
# One-time: authenticate wrangler, or set CLOUDFLARE_API_TOKEN.
bunx wrangler login                          # (account/dashboard step)

# Build the frontend, then publish the dist output.
bun run build
CLOUDFLARE_ACCOUNT_ID=<your-account-id> bunx wrangler pages deploy
```

`wrangler pages deploy` reads `pages_build_output_dir` from `wrangler.toml`, so
you do not repeat the directory on the command line. A convenient wrapper is a
`deploy:frontend` script in the root `package.json`:

```json
"deploy:frontend": "bun run build && CLOUDFLARE_ACCOUNT_ID=<your-account-id> bunx wrangler pages deploy"
```

### Frontend production env vars

Vite inlines `VITE_*` variables **at build time**, so they must be present when
the bundle is built (in `wrangler.toml` `[vars]`, in the Pages project settings,
or in the CI build environment) — not injected at runtime.

| Variable | Prod value | Dev value | Where it is read |
| --- | --- | --- | --- |
| `VITE_OPENKEY_HOST` | `https://openkey.so` | `https://openkey.so` | Frontend OpenKey client. Always the canonical public service. |
| `VITE_BACKEND_URL` | `https://api.<your-app>.example.com` | unset (derived from page protocol) | Frontend API client base URL. In dev it is derived from the page (`http://localhost:5175` → `http://localhost:3003`); in prod you must set it to the public backend URL. |

### Custom domain and TLS

Map your production domain (for example `my-app.example.com`) to the Pages
project in the Cloudflare dashboard **(account/dashboard step)**. Cloudflare
provisions and renews TLS for Pages automatically — you do not manage frontend
certificates.

---

## 2. Backend → Phala Cloud (TEE)

### Why a TEE

TinyCloud is a verifiable product. The backend holds a DID and operates on user
data through delegated capability, so users need a reason to trust that the
backend runs exactly the code it claims to. A Phala Cloud CVM is a TEE:
attestation proves the deployed image is the one that was built, so the backend
is not a black box that could quietly exfiltrate delegated access. This is why
the blessed backend target is Phala rather than an ordinary VM or serverless
host.

### Containerizing the Bun/Express backend

The app-starter backend is an Express server run by Bun (`bun src/index.ts`).
There is no backend `Dockerfile` in this repo yet — you add one. The pattern
below is adapted from a real deployed TinyCloud app and builds the shared
workspace packages plus the backend into a single image.

Create `backend/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3 AS app
WORKDIR /app

# husky's prepare script must be neutralized in CI/Docker.
ENV HUSKY=0

# Copy the workspace root + only the packages the backend needs.
COPY package.json tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY templates/app-starter/backend ./backend
COPY templates/app-starter/frontend/package.json ./frontend/package.json

RUN bun install
RUN cd packages/core && bun run build
RUN cd packages/server && bun run build
RUN cd backend && bun run build

WORKDIR /app/backend
EXPOSE 3003
CMD ["bun", "run", "start"]
```

Notes:

- Build for `linux/amd64` — Phala CVMs run amd64:
  `docker buildx build --platform linux/amd64 ...`.
- For a scaffolded standalone app, the paths are simpler (`COPY backend ./backend`,
  `COPY frontend/package.json ...`) because the scaffold flattens the layout.
- `@tinycloud/node-sdk-wasm` ships CJS wrappers that must be patched for ESM;
  the `@tinyboilerplate/server` postinstall handles this during `bun install`,
  so keep the package's `scripts/` present in the build context if you trim the
  workspace.

Add a `.dockerignore` at the repo root so secrets and build junk never enter the
image:

```gitignore
.git
.turbo
.wrangler
node_modules
**/node_modules
dist
**/dist
.env
.env.*
*.pem
*.tsbuildinfo
```

### Publish the image

Push an amd64 image to a registry Phala can read (GitHub Container Registry
works well):

```bash
docker buildx build --platform linux/amd64 \
  -f backend/Dockerfile \
  -t ghcr.io/<org>/<app>-backend:latest \
  --push .
```

The GHCR package must be readable by Phala **(account/dashboard step)**.

### `docker-compose.phala.yml`

Phala deploys a Docker Compose stack. A production backend needs two services:
the backend itself, and a TLS ingress that terminates HTTPS at your custom
domain and forwards to the backend. This shape is taken from a real deployed
TinyCloud app:

```yaml
services:
  app-backend:
    image: ${BACKEND_IMAGE:-ghcr.io/<org>/<app>-backend:latest}
    platform: linux/amd64
    ports:
      - "3003:3003"
    environment:
      NODE_ENV: production
      PORT: "3003"
      BACKEND_PRIVATE_KEY: ${BACKEND_PRIVATE_KEY}
      TINYCLOUD_HOST: ${TINYCLOUD_HOST:-https://tee.node.tinycloud.xyz}
      FRONTEND_URL: ${FRONTEND_URL:-https://my-app.example.com}
    restart: unless-stopped

  dstack-ingress:
    image: ${INGRESS_IMAGE:-ghcr.io/<org>/<app>-backend:ingress-latest}
    ports:
      - "443:443"
    depends_on:
      - app-backend
    environment:
      DOMAIN: ${PHALA_INGRESS_DOMAIN:-api.my-app.example.com}
      TARGET_ENDPOINT: http://app-backend:3003
      CLOUDFLARE_API_TOKEN: ${CLOUDFLARE_API_TOKEN}
      GATEWAY_DOMAIN: ${PHALA_GATEWAY_CNAME}
      CERTBOT_EMAIL: ${CERTBOT_EMAIL}
      SET_CAA: "true"
      DNS_PROVIDER: cloudflare
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
      - cert-data:/etc/letsencrypt
    restart: unless-stopped

volumes:
  cert-data:
```

The ingress image is a thin wrapper over `dstacktee/dstack-ingress`; it obtains
and renews a Let's Encrypt certificate for your custom domain using the
Cloudflare DNS API and the CVM's dstack socket. Reference this image from
`infra/phala-ingress/Dockerfile` (the real app pins a specific `dstack-ingress`
digest and overrides its entrypoint).

Add a `phala.toml` describing the CVM:

```toml
name = "<app>-backend"
profile = "<your-phala-profile>"
compose_file = "docker-compose.phala.yml"
gateway_domain = "api.my-app.example.com"
gateway_port = 3003
public_logs = false
public_sysinfo = true
```

### Deploy to Phala

Install and authenticate the Phala CLI, then deploy the compose stack against a
CVM with an env file **(account/dashboard step to create the CVM the first time
and obtain its CVM ID and gateway CNAME)**:

```bash
npm install -g phala
phala login                      # or set PHALA_CLOUD_API_KEY

phala deploy \
  --cvm-id <your-cvm-id> \
  -c docker-compose.phala.yml \
  -e .env.prod \
  --wait
```

After the CVM reports `running`, verify the public API — a deploy that boots but
fails TLS or backend startup should fail loudly, not look green:

```bash
curl -fsS https://api.my-app.example.com/health
curl -fsS https://api.my-app.example.com/api/server-info
```

> The app-starter backend exposes its health check at **`/health`** (see
> `templates/app-starter/backend/src/index.ts`). If you rename it, update these
> probes. `/api/server-info` must return the backend DID, policy, and
> `policyHash`.

### Backend production env vars

| Variable | Prod value | Dev value | Where it is read |
| --- | --- | --- | --- |
| `BACKEND_PRIVATE_KEY` | 0x-prefixed key from a secret store | generated by `bun run generate-key` | `templates/app-starter/backend/src/index.ts`. The backend's identity/DID. Required. |
| `TINYCLOUD_HOST` | `https://tee.node.tinycloud.xyz` | `https://node.tinycloud.xyz` | Backend node URL. Prod uses the direct TEE endpoint so backend-to-node traffic stays off the Cloudflare-proxied node endpoint. |
| `FRONTEND_URL` | `https://my-app.example.com` | derived, usually `http://localhost:5175` | CORS allowed origin. Must be the exact production frontend origin. |
| `PORT` | `3003` | `3003` | Listen port. |

### DNS for the backend domain

Point your backend domain at the Phala gateway **(account/dashboard step)**.
Two records are required, using values from `phala cvms get <cvm-id>`:

- `CNAME api.my-app.example.com` → the CVM's `gateway.cname`
- `TXT _dstack-app-address.api.my-app.example.com` → `<app_id>:443`

The `TXT` record is how the dstack gateway routes your custom domain to the
correct CVM. Verify both records resolve before the ingress can serve TLS.

---

## 3. OpenKey

Apps always use the canonical public OpenKey service at **`https://openkey.so`**.
Set `VITE_OPENKEY_HOST=https://openkey.so` for the frontend and (if your backend
verifies OpenKey-issued sessions) `OPENKEY_ISSUER_URL=https://openkey.so` for the
backend.

You must allowlist your production and local URLs in the OpenKey OAuth
client config so sign-in redirects and origins are accepted
**(account/dashboard step)**:

- production frontend origin (`https://my-app.example.com`)
- local dev origin(s) (`http://localhost:5175`, or your trusted-HTTPS localhost)

Do not run a self-hosted or custom-host OpenKey for a production app. The
custom-host option is dev-only plumbing.

---

## 4. Optional: the agent

If your app includes an agent, it is a third component with its own DID. The
frontend requests the agent's permissions in the same consent the user grants
for the app and backend, then delegates the agent-requested subset to the
agent's DID. In production the agent runs on the TinyCloud agent service, not
as a container you operate. For local development, `packages/agent-runtime`
ships an OpenCode + delegation-sidecar Docker image; see
`packages/agent-runtime/docker/README.md`. That local image is a dev/testing
convenience and is separate from the production agent-service path.

---

## 5. Continuous deployment (optional)

The repo's `.github/workflows/ci.yml` lints, builds, and tests — it does not
deploy. To automate deploys, add a workflow that, on `main`:

1. Builds and pushes the amd64 backend + ingress images to GHCR
   (`docker/build-push-action`).
2. Pins the pushed image tags into `docker-compose.phala.yml`.
3. Resolves the CVM gateway CNAME (`phala cvms get`), verifies the custom-domain
   DNS records, then runs `phala deploy --cvm-id ... --wait`.
4. Probes `/health` and `/api/server-info` after the CVM reports `running`.

A real TinyCloud app wires exactly this in a `deploy-backend-phala.yml` workflow
and gates it on required GitHub Actions secrets
(`PHALA_CLOUD_API_KEY`, `BACKEND_PRIVATE_KEY`, `CLOUDFLARE_API_TOKEN`,
`CERTBOT_EMAIL`). Frontend deploys can run from the same or a separate workflow
via `wrangler pages deploy`.

**Deploy auditability:** never deploy uncommitted code. Tag images by commit SHA
(`ghcr.io/<org>/<app>-backend:<sha>`) so every running backend traces to a
commit, and let the deploy fail if required secrets are missing rather than
shipping a half-configured stack.

---

## 6. Operational notes

### Backend key handling and rotation

`BACKEND_PRIVATE_KEY` is the backend's identity. Its DID is derived from this
key, and **user delegations are bound to that DID**. Consequences:

- Store the key in a real secret store (GitHub Actions secret, Phala deploy env
  file). Never commit it, never log it, never bake it into the image.
- **Rotating the key is a breaking change.** A new key means a new backend DID,
  which invalidates every existing user delegation — every user must sign in and
  re-grant access before backend-mediated routes work again. Treat rotation as a
  migration with user impact, not a routine ops task. Rotate only for key
  compromise or a deliberate identity change, and plan the re-consent rollout.

### SQL schema initialization

TinyCloud SQL databases are created lazily by the app, not by a migration step
run at deploy time. An app that uses SQL should ensure its tables exist before
its first query. The Notes example does this with an idempotent
`CREATE TABLE IF NOT EXISTS` guarded by a per-access cache — see
`ensureNotesSchema` in `examples/notes/backend/src/storage/notes.ts`, which every
read/write path calls first. Follow that pattern: there is no separate
"run migrations" deploy phase, so schema setup must be safe to call on every
request and must resolve the database identifier from the manifest/policy layer
so two apps never collide on a database name.

### TLS and CORS

- **Frontend TLS**: managed by Cloudflare Pages. No action beyond mapping the
  custom domain.
- **Backend TLS**: terminated by the dstack ingress inside the CVM using a
  Let's Encrypt certificate for your backend domain. Existing certificates are
  reused; the ingress only rewrites DNS/bootstraps a cert when it must.
- **CORS**: the backend sets its allowed origin from `FRONTEND_URL`
  (`app.use(cors({ origin: FRONTEND_URL }))` in the backend `index.ts`). In
  production this must be the exact frontend origin; a mismatch makes every
  browser request fail CORS even though the backend is healthy.

### WebAuthn / TLS certificate errors

OpenKey passkey (WebAuthn) flows fail on any page with a TLS certificate error,
even after clicking through a browser warning
(`WebAuthn is not supported on sites with TLS certificate errors`). Production
avoids this because Cloudflare and Let's Encrypt issue trusted certs. Keep it in
mind when testing against a staging domain that lacks a valid cert.

---

## Checklist

Frontend:

- [ ] `wrangler.toml` with `pages_build_output_dir = "frontend/dist"` and
      `[vars]` for `VITE_OPENKEY_HOST` / `VITE_BACKEND_URL`
- [ ] Cloudflare Pages project created and custom domain mapped
      **(account/dashboard step)**
- [ ] `bun run build && wrangler pages deploy`

Backend:

- [ ] `backend/Dockerfile` + root `.dockerignore`
- [ ] amd64 image pushed to a Phala-readable registry
- [ ] `docker-compose.phala.yml` (backend + ingress) and `phala.toml`
- [ ] CVM created; CVM ID and gateway CNAME obtained
      **(account/dashboard step)**
- [ ] Backend DNS: `CNAME` to gateway + `TXT _dstack-app-address...:443`
      **(account/dashboard step)**
- [ ] Prod env: `BACKEND_PRIVATE_KEY`, `TINYCLOUD_HOST=https://tee.node.tinycloud.xyz`,
      `FRONTEND_URL`, `PORT`
- [ ] `phala deploy --cvm-id ... -c docker-compose.phala.yml -e .env.prod --wait`
- [ ] `/health` and `/api/server-info` return 2xx over HTTPS

OpenKey:

- [ ] `VITE_OPENKEY_HOST=https://openkey.so`
- [ ] Production + local origins allowlisted in the OpenKey client
      **(account/dashboard step)**

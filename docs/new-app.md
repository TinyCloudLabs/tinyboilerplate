# Building a New App from TinyBoilerplate

TinyBoilerplate is the clean starting point for new TinyCloud + OpenKey apps.
For a new product, start from the minimal React + Express example unless you
explicitly need the advanced transcript-sync surface.

Listen is a separate reference implementation. It is not a dependency,
submodule, or fork base for this repo. This repo does include
`examples/conversation-sync`, which is a large Listen-derived reference app.
Treat it as advanced reference material, not as the default starter.

## 1. Choose the Starting Point

Use `examples/react-express` by default. It is the intended scaffold for a new
app and demonstrates the reusable substrate:

- OpenKey popup sign-in
- TinyCloud session creation and space auto-provisioning
- manifest-backed delegation from the user to the backend
- JWT-authenticated API routes
- backend-mediated KV, SQL, and DuckDB CRUD
- direct browser TinyCloud KV, SQL, and DuckDB access

Use `examples/conversation-sync` only when the new product really needs the
same category of advanced behavior:

- transcript ingestion
- Fireflies or Google Meet integration
- webhooks and pending queues
- TinyCloud Secrets grants to a backend
- multi-resource delegation bundles
- agent/OpenCode delegation handoff
- an inbox/detail/search UI for conversations

Do not copy `examples/conversation-sync` as a normal app starter. It still
contains Listen-shaped identifiers, copy, styles, app ids, source integrations,
and agent docs.

## 2. Copy and Rename Packages

Start by copying or forking the whole TinyBoilerplate repo. The examples depend
on the workspace packages in `packages/*`, so copying only `examples/react-express`
is not self-contained unless you also copy, publish, or replace those packages.

```bash
git clone https://github.com/tinycloudlabs/tinyboilerplate.git my-new-app
cd my-new-app
```

Then use `examples/react-express` as the app surface. Rename package names in:

- root `package.json`
- `examples/react-express/package.json`
- `examples/react-express/frontend/package.json`
- `examples/react-express/backend/package.json`

Keep shared imports as `@tinyboilerplate/*` while developing inside this
monorepo. Rename or publish those shared packages only if the new app is being
split into its own package namespace.

## 3. Set App Identity

Choose a stable app id before users create data. Recommended format:

```text
xyz.tinycloud.<app-name>
```

For `examples/react-express`, replace:

- `examples/react-express/frontend/public/manifest.json`: `app_id`, `name`, `description`
- `examples/react-express/backend/src/routes/items.ts`: `APP_ID`
- `examples/react-express/frontend/src/components/DirectStorage.tsx`: `APP_ID`

Also rename app-facing display text:

- `examples/react-express/frontend/src/App.tsx`: title/subtitle/footer copy
- `examples/react-express/backend/src/routes/server-info.ts`: backend display name and permission descriptions
- `examples/react-express/backend/openapi.yaml`: API title if the app exposes docs
- `examples/react-express/README.md`: product name, setup notes, and data model examples

Do not reuse `com.example.app` for a real product.

## 4. Configure Auth and Environment

1. Register or choose an OpenKey OAuth client for the new frontend origin.
2. Copy the example env file:

```bash
cp .env.example .env
```

3. Set backend values:
   - `BACKEND_PRIVATE_KEY`: generate with `bun run generate-key`
   - `TINYCLOUD_HOST`: optional, defaults to the production TinyCloud node
   - `FRONTEND_URL`: exact frontend origin
   - `PORT`: backend port
4. Set frontend values:
   - `VITE_OPENKEY_HOST`: OpenKey issuer, usually `https://openkey.so`
   - `VITE_OPENKEY_CLIENT_ID`: OpenKey client id if required by the OpenKey setup
   - `VITE_BACKEND_URL`: exact backend origin

Backend identity is app-owned. User data access happens through user-granted
TinyCloud delegation.

## 5. Update Storage and Session Names

Rename storage keys before shipping a real app:

- TinyCloud KV prefixes derived from `APP_ID`
- TinyCloud SQL and DuckDB database names derived from `APP_ID`
- browser storage keys such as `tinyboilerplate:session` and `tinyboilerplate:storeType`
- CSRF/request header display values if branded diagnostics matter
- OpenKey app display names passed through the auth flow

Changing these after users have data is a migration, not a rename.

## 6. Replace the Example Domain Model

`examples/react-express` uses `Item` as the placeholder model. Replace it with
your product model in this order:

1. Update shared types in `packages/core/src/index.ts`.
2. Copy `backend/src/routes/items.ts` to a new route module.
3. Rename KV prefixes, database names, table names, and SQL statements.
4. Mount the new route in `backend/src/index.ts`.
5. Replace `frontend/src/components/ItemsCRUD.tsx` with the new product UI.
6. Update `frontend/public/manifest.json` and `/api/server-info` permissions so
   they cover only the storage surfaces the app actually uses.

Keep the auth, session, delegation, CSRF, and API-client flow intact unless the
new app has a specific reason to change it.

## 7. Verify the Scaffold

From the TinyBoilerplate repo before copying or after rebasing:

```bash
rm -rf node_modules
bun install --frozen-lockfile
bun run format:check
bun run build
bun test packages/client/src packages/server/src examples/react-express/backend/src examples/conversation-sync/backend/src
cd examples/conversation-sync/frontend && bunx vitest run
```

For a copied full-repo scaffold using React + Express, run at least:

```bash
bun install --frozen-lockfile
bun run build
bun test packages/client/src packages/server/src examples/react-express/backend/src
```

Then run the app locally:

```bash
bun run dev
```

Sign in, grant the backend delegation, and complete one read/write path through
the backend. If the app exposes direct browser TinyCloud access, verify one
direct KV, SQL, or DuckDB operation too.

## 8. Conversation Sync Is Advanced Reference

`examples/conversation-sync` is intentionally not the default fork base. It is
useful for inspecting mature patterns, including:

- manifest-backed delegation with runtime grants
- backend policy-hash checks for stale delegations
- portable multi-resource delegation activation
- TinyCloud Secrets sharing with a backend DID
- Fireflies and Google Meet sync flows
- webhook verification and pending queues
- agent delegation handoff to an OpenCode-style container

If you do copy it for a transcript product, rename all Listen-specific surfaces:

- `manifest.json`: `xyz.tinycloud.listen` and hook paths
- frontend title, shell branding, landing copy, and localStorage keys
- Fireflies and Google Meet source labels if the product does not use them
- `docker-compose.yml` service, image, container, volume, and prefix names
- `agent/CLAUDE.md` product name, schema notes, and command examples
- README files, generated readme HTML, OpenAPI title, and portless hostnames
- tests that assert Listen-specific app ids, copy, storage paths, or source names

Do not copy Listen product code into a new app by default. Fireflies, Granola,
Google Meet, transcript UI, and Listen-specific storage schemas belong to
Listen unless the new product explicitly needs them.

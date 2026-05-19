# Building a New App from TinyBoilerplate

TinyBoilerplate is the clean starting point for new TinyCloud + OpenKey apps. Listen is a useful reference implementation, but do not fork Listen unless you are building Listen-specific transcript features.

## 1. Create the App Workspace

1. Copy the repo or the example you want to start from.
   - Use `examples/react-express` for a minimal KV/SQL CRUD app.
   - Use `examples/conversation-sync` only when you need manifest-driven sync, webhooks, or agent-delegation patterns.
2. Rename packages in the copied app:
   - frontend `package.json` `name`
   - backend `package.json` `name`
   - root/example `package.json` `name` if you copy a nested example workspace
3. Keep the shared package imports as `@tinyboilerplate/*` until you intentionally publish or rename the shared packages.

## 2. Set App Identity

Choose a stable app id before users create data. Recommended format:

```text
xyz.tinycloud.<app-name>
```

Replace all app-scoped ids and prefixes in the copied app:

- `examples/react-express/frontend/public/manifest.json`: `app_id`, `name`, `description`
- `examples/react-express/backend/src/routes/items.ts`: `APP_ID`
- `examples/react-express/frontend/src/components/DirectStorage.tsx`: `APP_ID`
- `examples/conversation-sync/manifest.json`: `app_id`, `name`, `description`
- `examples/conversation-sync/backend/src/manifest.ts`: backend delegation name/expiry only if the copied product wording should change

Do not reuse `com.example.app` or `xyz.tinycloud.listen` for a new product.

## 3. Configure Auth and Environment

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
   - `VITE_OPENKEY_CLIENT_ID`: OpenKey client id if the copied app requires explicit client registration
   - `VITE_BACKEND_URL`: exact backend origin

Backend identity is app-owned. User data access happens through user-granted TinyCloud delegation.

## 4. Update Storage and Session Names

Rename storage keys before shipping a real app:

- TinyCloud KV/SQL prefixes derived from `APP_ID`
- SQL database names derived from `APP_ID`
- browser storage keys such as `tinyboilerplate:session` and `tinyboilerplate:storeType`
- CSRF/request header display values if you want branded diagnostics instead of `TinyBoilerplate`
- OpenKey app display name passed through `createOpenKey`

Changing these after users have data is a migration, not a rename.

## 5. Verify the Scaffold

From a clean checkout:

```bash
rm -rf node_modules
bun install --frozen-lockfile
bun run format:check
bun run build
bun test packages/client/src packages/server/src examples/react-express/backend/src examples/conversation-sync/backend/src
cd examples/conversation-sync/frontend && bunx vitest run
```

Then run the copied app locally:

```bash
bun run dev
```

Sign in, grant the backend delegation, and complete one read/write path through the backend. If the app exposes direct browser TinyCloud access, verify one direct KV or SQL operation too.

## 6. Keep Listen as Reference Only

Use Listen to inspect mature patterns for:

- manifest-backed delegation
- runtime grants
- backend delegation activation
- agent delegation handoff
- production deployment wiring

Do not copy Listen product code into a new app by default. Fireflies, Granola, Google Meet, transcript UI, and Listen-specific storage schemas belong to Listen unless the new product explicitly needs them.

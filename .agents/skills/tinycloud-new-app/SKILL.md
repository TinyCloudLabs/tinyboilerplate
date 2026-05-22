---
name: tinycloud-new-app
description: Helps Codex create, scaffold, verify, explain, or debug a new TinyCloud app from tinyboilerplate. Use when a user asks for a new TinyCloud app, app scaffold, blank starter, generated standalone app, TinyCloud app creation workflow, backend delegation setup, OpenKey/WebAuthn local auth troubleshooting, or verification of a generated TinyCloud app.
---

# TinyCloud New App

## Source Order

Start from the tinyboilerplate repository that contains this skill. If the current working directory is elsewhere, locate the checkout by finding a repo with `scripts/scaffold-app.ts`, `templates/app-starter/**`, and `docs/app-architecture.md`; if there is more than one candidate, ask which checkout to use.

Treat these as canonical:

- `docs/app-architecture.md`: architecture contract.
- `README.md`: scaffold and verification flow.
- `templates/app-starter/**`: blank app baseline.
- `examples/notes/**`: first real example app.
- `scripts/scaffold-app.ts` and `scripts/scaffold-app.test.ts`: CLI behavior and guarantees.

Do not reference other product repositories, product names, product URLs, or proprietary readmes from this skill. If non-tinyboilerplate architecture context is needed, first convert it into sanitized, generic TinyCloud guidance and store only that local, name-free reference material.

Load `references/architecture-guardrails.md` when changing auth, delegation, storage, OpenAPI, SQL/KV writes, local TLS, or real-auth verification.

## Scaffold Workflow

1. Choose:
   - `app_id`: stable user-data prefix, usually `xyz.tinycloud.<app>`.
   - `app_name`: user-facing product name.
   - `backend_prefix`: slash-free backend operational prefix, such as `xyz.tinycloud.<app>-backend` or `ops.<app>.backend`.
   - frontend/backend package names and unused local ports.
2. Run the CLI from tinyboilerplate:

```bash
bun run scaffold:app -- --out ../my-app --app-id xyz.tinycloud.my-app --app-name "My TinyCloud App" --backend-prefix xyz.tinycloud.my-app-backend --frontend-package @my-app/tinycloud-frontend --backend-package @my-app/tinycloud-backend --frontend-port 5185 --backend-port 3013
```

3. Verify the generated standalone app:

```bash
cd ../my-app
bun install
bun run generate-key
bun run build
bun run test
```

4. Configure and run locally:

```bash
cp frontend/.env.example frontend/.env
bun run dev
```

Use HTTP localhost first unless trusted HTTPS is configured. Never use a browser HTTPS certificate-warning page for OpenKey/WebAuthn checks.

## Source Repo Verification

When editing tinyboilerplate itself, run the relevant subset and broaden as risk grows:

```bash
bun install --frozen-lockfile
bun run format:check
bun run build
bun test templates/app-starter/backend/src
bun test examples/notes/backend/src
bun test scripts/scaffold-app.test.ts
bun run test:browser:app-shell
```

For scaffold-only changes, `bun test scripts/scaffold-app.test.ts` is the scaffold integration test. For product/example changes, run the focused backend tests for the touched app.

## Architecture Rules

- Say "space", not "namespace" or "orbit", except for ReCap/spec terminology.
- The browser signs in the user, owns consent, and creates the user-owned delegation.
- The backend has its own operational identity and slash-free operational prefix. Backend state must not collide with app user data or with other apps using the same backend key.
- The backend touches user data only through activated delegated TinyCloud access.
- Accepted delegations must bind both the authenticated user and the expected backend delegatee DID.
- Store the resolved backend policy hash with each delegation. Policy hash drift must invalidate the old delegation.
- Treat `stale` delegation status as first-class in backend responses, frontend state, shared types, OpenAPI, and tests.
- Multi-resource delegations need explicit per-resource activation and service routing.
- JSON document reads from TinyCloud KV can come back as strings or already-parsed objects; decode both and test the parsed-object read path.
- OpenAPI must describe real behavior: auth schemes, request bodies, response bodies, errors, and delegation status enums.
- SQL/KV split writes need explicit partial-failure semantics and tests.

## Verification Limits

Default build, backend, scaffold, and browser-shell smoke checks do not verify real OpenKey sign-in, WebAuthn, TinyCloud space creation, or browser-to-backend delegation.

Only claim real auth was verified after running a browser flow that signs in, grants the backend delegation, and exercises the delegated route, such as reading and updating the starter probe or creating/editing/deleting a Notes record.

For tinyboilerplate/app-starter, the canonical real-auth check is local and interactive:

```bash
bun run test:real-auth
```

This command must open headed Playwright, let the human complete real OpenKey/TinyCloud sign-in and backend delegation, then continue in that same live browser context to update and verify the delegated probe. Do not reintroduce storage-state fixtures, setup/replay split commands, CI replay workflows, GitHub credential secrets, or environment-protected auth fixtures.

If the passkey UI asks for an external security key or says to insert a key, rerun with installed Chrome and, only when needed, a local ignored profile:

```bash
REAL_AUTH_BROWSER=chrome REAL_AUTH_USER_DATA_DIR=.auth/chrome-profile bun run test:real-auth
```

The profile is local-only browser state, not a repo fixture and not CI material. Prefer a fresh ephemeral Chrome context when possible:

```bash
REAL_AUTH_BROWSER=chrome bun run test:real-auth
```

For local auth, use HTTP localhost when supported or trusted HTTPS. Cert-error HTTPS can fail with:

```text
WebAuthn is not supported on sites with TLS certificate errors
```

When app-starter runs on mkcert HTTPS, Bun/backend polling may need the mkcert root CA:

```bash
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" REAL_AUTH_BROWSER=chrome bun run test:real-auth
```

Do not use browser certificate-error bypasses or `ignoreHTTPSErrors` for real-auth/WebAuthn verification.

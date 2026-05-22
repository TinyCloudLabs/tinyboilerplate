# TinyCloud Notes

TinyCloud Notes is the first real TinyCloud example app in this repo. It uses
OpenKey for identity, a backend session for API authentication, and delegated
TinyCloud access for user-owned note data.

## Local TLS

OpenKey/passkey checks may use HTTP localhost when the identity flow supports
it; otherwise use trusted HTTPS. Never use HTTPS with a browser certificate
warning for WebAuthn.

Searchable error:
`WebAuthn is not supported on sites with TLS certificate errors`.

If you already have app-starter certs in this checkout, copy them locally from
the repo root:

```bash
cp templates/app-starter/frontend/localhost.pem examples/notes/frontend/localhost.pem
cp templates/app-starter/frontend/localhost-key.pem examples/notes/frontend/localhost-key.pem
```

Or generate fresh mkcert certs:

```bash
mkcert -install
mkcert -key-file frontend/localhost-key.pem -cert-file frontend/localhost.pem localhost 127.0.0.1 ::1
```

When those files exist:

- the frontend serves `https://localhost:5174`
- the backend auto-serves `https://localhost:3002`
- the backend CORS origin defaults to `https://localhost:5174`
- the frontend default backend URL matches the page protocol

Without those files, both servers fall back to HTTP.

## Run

From the repo root:

```bash
bun run packages/server/scripts/generate-key.ts examples/notes/backend/.env
cp examples/notes/frontend/.env.example examples/notes/frontend/.env
# If examples/notes/backend/.env already existed, replace BACKEND_PRIVATE_KEY
# with the printed key.
bun run dev:notes
```

For backend startup you still need `BACKEND_PRIVATE_KEY` in
`examples/notes/backend/.env` or your shell environment.

## Verification

Build and route tests are smoke checks:

```bash
bun run build
bun test examples/notes/backend/src
```

They verify the app shell and backend contract without a browser identity. To
exercise OpenKey/WebAuthn, TinyCloud space setup, and backend delegation through
the scripted real-auth fixture, run from the repo root:

```bash
bun run test:real-auth:setup
bun run test:real-auth
```

The setup command requires a human to sign in and grant the delegation, then the
replay command reuses the saved Playwright auth state. It launches installed
Chrome when available so platform passkeys behave like a normal browser. If it
asks for an external security key or says to insert a key, rerun with:

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

To verify the real Notes flow manually, start the app, sign in with OpenKey,
grant the backend delegation, then create, edit, list, and delete a note. Use
HTTP localhost when supported by the identity flow, or a trusted HTTPS localhost
certificate. An HTTPS warning page is not a valid WebAuthn/passkey test
environment.

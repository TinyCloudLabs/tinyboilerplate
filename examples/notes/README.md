# TinyCloud Notes

TinyCloud Notes is the first real TinyCloud example app in this repo. It uses
OpenKey for identity, a backend session for API authentication, and delegated
TinyCloud access for user-owned note data.

Notes demonstrates the full TinyCloud mini-app package shape: `manifest.json`,
runnable app code, and `knowledge/` resource notes for humans and agents.

## UI Style

Notes demonstrates the preferred example-app surface: a compact header with
sign-in and tucked-away connection details, then the app's real work. The first
screen should be the note list beside the create/edit panel, not an account
status dashboard.

When extending the example, keep the minimal tool style: neutral gray page,
white panels, subtle borders, compact system typography, and no fake nav or
protocol explainer panels. Add navigation only when there are real routes or
modes.

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
bun run check:app-packages
bun run build
bun test examples/notes/backend/src
```

They verify the app shell and backend contract without a browser identity. To
verify the real Notes flow, start the app, sign in with OpenKey, grant the
backend delegation, then create, edit, list, and delete a note.

Use HTTP localhost when supported by the identity flow, or a trusted HTTPS
localhost certificate. An HTTPS warning page is not a valid WebAuthn/passkey
test environment. If the browser reports:

```text
WebAuthn is not supported on sites with TLS certificate errors
```

stop and fix local TLS instead of clicking through the warning or using
`ignoreHTTPSErrors`.

When using trusted mkcert HTTPS, Bun/backend requests may also need the mkcert
root CA:

```bash
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" bun run dev:notes
```

# Architecture Guardrails

Use this reference when modifying more than the generated names, ports, docs, or package metadata.

## Canonical Versus Reference

- Canonical contract: `tinyboilerplate/docs/app-architecture.md`.
- Canonical blank baseline: `tinyboilerplate/templates/app-starter/**`.
- Canonical first product example: `tinyboilerplate/examples/notes/**`.
- Canonical CLI behavior: `tinyboilerplate/scripts/scaffold-app.ts` and `scripts/scaffold-app.test.ts`.
- Do not depend on other product repositories, product names, product URLs, or proprietary readmes. If outside architecture context is needed, import only sanitized generic guidance into this skill or tinyboilerplate before using it.

## Delegation Contract

- `/api/server-info` advertises backend DID, delegate name, expiry, resolved policy hash, and requested permissions.
- `/api/manifest` is the user-facing app-data capability surface. Do not add legacy `backend` or `delegations` sections to v1 manifests.
- The frontend composes the app manifest with backend policy before sign-in and creates a portable delegation for the backend DID.
- `POST /api/delegations` must require backend session auth, deserialize the delegation, verify delegator/user identity, verify delegatee DID, normalize granted resources, check policy coverage, activate delegated access, then store the serialized delegation with expiry, resources, and policy hash.
- `GET /api/delegations/status` must distinguish at least `none`, `expired`, `stale`, and `active`.
- Middleware must evict expired or stale-policy records before delegated routes run.

## Storage Boundaries

- User-owned data belongs under the app id, for example `xyz.tinycloud.<app>/<model>`.
- Backend-owned operational state belongs under a separate slash-free backend prefix.
- Do not store raw user secrets in backend routes, logs, KV, SQL, or env files. Browser writes secrets to TinyCloud and grants backend access when needed.
- KV reads can return structured JSON either as the original string or as an already-parsed object. Storage decoders for JSON documents must accept both shapes, and tests should cover create-then-list/read with parsed JSON coming back from KV.
- For named SQL or DuckDB databases, use explicit helpers with resolved database identifiers. Do not rely on default database shortcuts.
- For SQL metadata plus KV body models, write and compensate deliberately. Cover KV-before-SQL create, update failure, delete failure, and orphan hydration behavior in tests.

## Multi-Resource Delegations

A portable delegation can grant multiple services or resources. Activate each resource as needed and route only the handle for the service being activated. Do not blindly copy all handles from one access object over another, because a handle scoped to one resource can replace a correctly scoped handle for a different service.

## OpenAPI And State

OpenAPI is a contract, not a summary. Include bearer auth, request schemas, response schemas, reusable error responses, and delegation status values. Keep frontend states explicit: restored backend session, checking delegation, needs delegation, expired, stale, ready, saving, and recoverable error are different states.

## Local Auth And WebAuthn

Prefer HTTP localhost while developing unless a trusted local certificate is configured. If using HTTPS, both frontend and backend should use the trusted certs and matching protocol/CORS settings. Do not debug WebAuthn on a certificate-warning page.

Searchable failure:

```text
WebAuthn is not supported on sites with TLS certificate errors
```

## Real-Auth Verification

Default smoke tests are intentionally credential-free. A real-auth pass requires a browser session that signs in through OpenKey, creates or restores the TinyCloud space, grants the backend delegation, and exercises a delegated backend route. Say explicitly when this was not run.

For tinyboilerplate/app-starter, keep real-auth local and interactive:

- Use `bun run test:real-auth` as the single command.
- Open headed Playwright and let the human complete sign-in/delegation.
- Continue in the same live browser context to update and verify the delegated probe.
- Do not store Playwright storage-state fixtures, split setup/replay commands, add CI replay workflows, or create GitHub secrets/environments for credential replay.
- If the passkey prompt says to insert a key, prefer installed Chrome with `REAL_AUTH_BROWSER=chrome`; use `REAL_AUTH_USER_DATA_DIR=.auth/chrome-profile` only as local ignored browser state when platform passkeys need it.
- For mkcert HTTPS, provide `NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"` to the command so backend polling trusts the same local CA.
- Never use `ignoreHTTPSErrors` or browser certificate-warning bypasses for WebAuthn verification.

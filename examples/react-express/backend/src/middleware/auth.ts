import {
  createAuthMiddleware as createServerAuthMiddleware,
  createJWTVerifier,
} from "@tinyboilerplate/server";

// ── Environment ──────────────────────────────────────────────────────

const OPENKEY_ISSUER_URL = process.env.OPENKEY_ISSUER_URL ?? "https://openkey.so";

const OPENKEY_CLIENT_ID = process.env.OPENKEY_CLIENT_ID;

// ── Auth Middleware ──────────────────────────────────────────────────

/**
 * JWT-based auth middleware.
 *
 * Verifies the Bearer token via JWKS, resolves the user's wallet address
 * from the OpenKey userinfo endpoint, and attaches `req.user` with
 * `{ sub, address, claims }`.
 *
 * Uses `createAuthMiddleware` from `@tinyboilerplate/server` under the hood.
 */
export function createAuthMiddleware() {
  const verify = createJWTVerifier(OPENKEY_ISSUER_URL, {
    audience: OPENKEY_CLIENT_ID,
  });

  return createServerAuthMiddleware({
    verify,
    openKeyUrl: OPENKEY_ISSUER_URL,
  });
}

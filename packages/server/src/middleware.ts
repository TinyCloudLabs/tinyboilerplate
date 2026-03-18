import { TinyBoilerplateError } from "@tinyboilerplate/core";
import { fetchUserInfo } from "./auth.js";
import type { JWTClaims, VerifyResult } from "./auth.js";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Configuration for the auth middleware factory.
 */
export interface AuthMiddlewareConfig {
  /** The verify function returned by `createJWTVerifier`. */
  verify: (authHeaderOrToken: string) => Promise<VerifyResult>;
  /** OpenKey URL for fetching user address via the userinfo endpoint. */
  openKeyUrl?: string;
  /**
   * Custom function to resolve the user's address from JWT claims and token.
   * Overrides the default resolution strategy (claims.address → userinfo → claims.sub).
   */
  resolveAddress?: (
    claims: JWTClaims,
    token: string,
  ) => Promise<string> | string;
}

/**
 * The authenticated user object attached to the request by the middleware.
 */
export interface AuthenticatedUser {
  /** The `sub` claim from the JWT (user identifier). */
  sub: string;
  /** The user's resolved address (wallet address or fallback to sub). */
  address: string;
  /** The full set of JWT claims for downstream access. */
  claims: JWTClaims;
}

// ── AuthError ────────────────────────────────────────────────────────

/**
 * Typed error for authentication failures.
 * Carries an HTTP status code and a machine-readable error code.
 */
export class AuthError extends TinyBoilerplateError {
  public readonly status: number;

  constructor(status: number, code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "AuthError";
    this.status = status;
  }
}

// ── Core Authentication Logic ────────────────────────────────────────

/**
 * Framework-agnostic authentication function.
 *
 * Extracts the Bearer token, verifies it, and resolves the user's address.
 * Use this directly when your framework doesn't follow the (req, res, next)
 * pattern (e.g., Hono's `c.req.header()`).
 *
 * Address resolution order:
 * 1. `config.resolveAddress(claims, token)` — custom resolver
 * 2. `claims.address` — if the JWT contains an address claim
 * 3. `fetchUserInfo(openKeyUrl, token).address` — if openKeyUrl is set
 * 4. `claims.sub` — fallback to the subject claim
 *
 * @throws {AuthError} on missing token (401) or verification failure (401)
 */
export async function authenticateRequest(
  authHeader: string | undefined,
  config: AuthMiddlewareConfig,
): Promise<AuthenticatedUser> {
  if (!authHeader) {
    throw new AuthError(
      401,
      "missing_token",
      "Authorization header is required",
    );
  }

  let verifyResult: VerifyResult;
  try {
    verifyResult = await config.verify(authHeader);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AuthError(401, "invalid_token", `Token verification failed: ${message}`, { cause: err });
  }

  const { claims, token } = verifyResult;

  // Resolve the user's address
  let address: string;
  if (config.resolveAddress) {
    address = await config.resolveAddress(claims, token);
  } else if (
    claims.address != null &&
    typeof claims.address === "string" &&
    claims.address.length > 0
  ) {
    address = claims.address;
  } else if (config.openKeyUrl) {
    const info = await fetchUserInfo(config.openKeyUrl, token);
    address = info.address ?? claims.sub;
  } else {
    address = claims.sub;
  }

  return { sub: claims.sub, address, claims };
}

// ── Generic Middleware Types ─────────────────────────────────────────

/**
 * Minimal request shape compatible with Express, Koa, Fastify, and similar
 * frameworks. No framework-specific dependencies required.
 */
export interface MiddlewareRequest {
  headers: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

/**
 * Minimal response shape for sending JSON error responses.
 */
export interface MiddlewareResponse {
  status(code: number): MiddlewareResponse;
  json(body: unknown): void;
}

/** Standard next-function signature. */
export type NextFunction = (err?: unknown) => void;

// ── Middleware Factory ───────────────────────────────────────────────

/**
 * Create an auth middleware for Express-style frameworks.
 *
 * Extracts the Authorization header, verifies the token, resolves the
 * user's address, and attaches an `AuthenticatedUser` object to `req.user`.
 *
 * Works with any framework that follows the `(req, res, next)` convention
 * (Express, Fastify with middleware mode, etc.). For Hono, use
 * `authenticateRequest` directly with `c.req.header("authorization")`.
 *
 * @example
 * ```typescript
 * import { createAuthMiddleware, createJWTVerifier } from "@tinyboilerplate/server";
 *
 * const verify = createJWTVerifier("https://openkey.so", { audience: CLIENT_ID });
 * const authMiddleware = createAuthMiddleware({
 *   verify,
 *   openKeyUrl: "https://openkey.so",
 * });
 *
 * app.use("/api/protected", authMiddleware);
 * ```
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  return async (
    req: MiddlewareRequest,
    res: MiddlewareResponse,
    next: NextFunction,
  ) => {
    try {
      const authHeader = req.headers.authorization as string | undefined;
      const user = await authenticateRequest(authHeader, config);
      req.user = user;
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({
          error: err.code,
          message: err.message,
        });
      } else {
        res.status(401).json({
          error: "auth_failed",
          message: "Authentication failed",
        });
      }
    }
  };
}

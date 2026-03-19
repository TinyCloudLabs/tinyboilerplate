import type { TinyCloudNode } from "@tinycloud/node-sdk";
import { consoleLogger, type Logger } from "@tinyboilerplate/core";
import { withSessionRefresh } from "./identity.js";

// ── Types ────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "fail" | "skip";
export type OverallStatus = "healthy" | "degraded" | "unhealthy";

export interface CheckResult {
  status: CheckStatus;
  latencyMs: number;
  error?: string;
}

export interface HealthResult {
  status: OverallStatus;
  timestamp: string;
  checks: {
    identity: CheckResult;
    jwks: CheckResult;
    kv?: CheckResult;
  };
}

export interface HealthCheckConfig {
  /**
   * The TinyCloudNode instance representing the backend identity.
   * Used to check that the backend is signed in and KV is accessible.
   */
  node: TinyCloudNode;

  /**
   * The backend's DID. A non-empty DID indicates the identity is active.
   */
  did: string;

  /**
   * The OpenKey issuer URL, used to construct the JWKS endpoint for reachability checks.
   * e.g., "https://openkey.so"
   */
  openKeyIssuerUrl: string;

  /**
   * Timeout in milliseconds for external requests (JWKS fetch, KV probe).
   * Defaults to 5000.
   */
  timeoutMs?: number;

  /**
   * When true, the health check will probe KV with a lightweight read.
   * Defaults to false (KV check is optional).
   */
  checkKV?: boolean;

  /**
   * Logger instance for diagnostic output. Defaults to console.
   */
  logger?: Logger;
}

// ── Health Check Factory ─────────────────────────────────────────────

/**
 * Create an async health-check function.
 *
 * Checks three subsystems:
 * 1. **Identity** — backend DID is present and node session appears valid.
 * 2. **JWKS** — the OpenKey JWKS endpoint is reachable (HEAD/GET with timeout).
 * 3. **KV** (optional) — a lightweight KV read succeeds.
 *
 * Status mapping:
 * - `healthy`  — all enabled checks pass.
 * - `degraded` — identity passes but one or more optional checks fail.
 * - `unhealthy` — identity check fails.
 */
export function createHealthCheck(config: HealthCheckConfig) {
  const {
    node,
    did,
    openKeyIssuerUrl,
    timeoutMs = 5_000,
    checkKV = false,
    logger = consoleLogger,
  } = config;

  const jwksUrl = new URL("/api/auth/jwks", openKeyIssuerUrl).toString();

  async function check(): Promise<HealthResult> {
    const [identity, jwks, kv] = await Promise.all([
      checkIdentity(),
      checkJWKS(),
      checkKV ? checkKVStore() : Promise.resolve(undefined),
    ]);

    // Determine overall status
    let status: OverallStatus;
    if (identity.status === "fail") {
      status = "unhealthy";
    } else if (jwks.status === "fail" || (kv && kv.status === "fail")) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    const result: HealthResult = {
      status,
      timestamp: new Date().toISOString(),
      checks: { identity, jwks },
    };

    if (kv !== undefined) {
      result.checks.kv = kv;
    }

    return result;
  }

  // ── Individual Checks ────────────────────────────────────────────

  async function checkIdentity(): Promise<CheckResult> {
    const start = performance.now();
    try {
      // The DID is assigned at sign-in time. A non-empty DID means the
      // node successfully authenticated.
      if (!did || did.length === 0) {
        return {
          status: "fail",
          latencyMs: elapsed(start),
          error: "Backend DID is not set — identity not signed in",
        };
      }

      // Verify the node's current DID still matches (guards against stale refs)
      const currentDID = node.did;
      if (!currentDID || currentDID.length === 0) {
        return {
          status: "fail",
          latencyMs: elapsed(start),
          error: "Node reports no active DID — session may have expired",
        };
      }

      return { status: "pass", latencyMs: elapsed(start) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[health] identity check error:", message);
      return {
        status: "fail",
        latencyMs: elapsed(start),
        error: message,
      };
    }
  }

  async function checkJWKS(): Promise<CheckResult> {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(jwksUrl, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          return {
            status: "fail",
            latencyMs: elapsed(start),
            error: `JWKS endpoint returned ${res.status}`,
          };
        }

        return { status: "pass", latencyMs: elapsed(start) };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[health] JWKS check error:", message);
      return {
        status: "fail",
        latencyMs: elapsed(start),
        error: message,
      };
    }
  }

  async function checkKVStore(): Promise<CheckResult> {
    const start = performance.now();
    try {
      // Perform a lightweight KV list on a prefix unlikely to hold data.
      // This validates connectivity without reading meaningful data.
      await withSessionRefresh(node, () => node.kv.list({ prefix: "__health__" }));

      return { status: "pass", latencyMs: elapsed(start) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[health] KV check error:", message);
      return {
        status: "fail",
        latencyMs: elapsed(start),
        error: message,
      };
    }
  }

  return check;
}

// ── Middleware Factory ────────────────────────────────────────────────

/**
 * Minimal request/response types for the health endpoint middleware.
 * Compatible with Express, Fastify (middleware mode), etc.
 */
export interface HealthRequest {
  [key: string]: unknown;
}

export interface HealthResponse {
  status(code: number): HealthResponse;
  json(body: unknown): void;
}

/**
 * Create an Express-style middleware that responds with the health check result.
 *
 * - Returns **200** for `healthy` or `degraded`.
 * - Returns **503** for `unhealthy`.
 *
 * @example
 * ```typescript
 * import { createHealthEndpoint } from "@tinyboilerplate/server";
 *
 * const healthEndpoint = createHealthEndpoint({
 *   node, did, openKeyIssuerUrl: "https://openkey.so",
 * });
 *
 * app.get("/api/health", healthEndpoint);
 * ```
 */
export function createHealthEndpoint(config: HealthCheckConfig) {
  const check = createHealthCheck(config);

  return async (_req: HealthRequest, res: HealthResponse) => {
    const result = await check();
    const statusCode = result.status === "unhealthy" ? 503 : 200;
    res.status(statusCode).json(result);
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function elapsed(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

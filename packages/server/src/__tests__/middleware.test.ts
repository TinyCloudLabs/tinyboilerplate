import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { authenticateRequest, createAuthMiddleware, AuthError } from "../middleware.js";
import type {
  AuthMiddlewareConfig,
  AuthenticatedUser,
  MiddlewareRequest,
  MiddlewareResponse,
} from "../middleware.js";
import type { VerifyResult, JWTClaims } from "../auth.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeClaims(overrides?: Partial<JWTClaims>): JWTClaims {
  return {
    sub: "user-123",
    iss: "https://openkey.so",
    aud: "my-app",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function makeVerifyResult(claims?: Partial<JWTClaims>, token = "valid-token"): VerifyResult {
  return { claims: makeClaims(claims), token };
}

/** A verify function that always succeeds. */
function successVerify(
  claimsOverrides?: Partial<JWTClaims>,
): (authHeaderOrToken: string) => Promise<VerifyResult> {
  return async (authHeaderOrToken: string) => {
    const token = authHeaderOrToken.startsWith("Bearer ")
      ? authHeaderOrToken.slice(7)
      : authHeaderOrToken;
    return makeVerifyResult(claimsOverrides, token);
  };
}

/** A verify function that always rejects. */
function failVerify(
  message = "Invalid token",
): (authHeaderOrToken: string) => Promise<VerifyResult> {
  return async () => {
    throw new Error(message);
  };
}

/** Create a mock request object. */
function mockReq(headers: Record<string, string | undefined> = {}): MiddlewareRequest {
  return { headers } as MiddlewareRequest;
}

/** Create a mock response object that captures the status and json body. */
function mockRes(): MiddlewareResponse & {
  _status: number | null;
  _body: unknown;
} {
  const res = {
    _status: null as number | null,
    _body: undefined as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._body = body;
    },
  };
  return res;
}

// ── authenticateRequest ──────────────────────────────────────────────

describe("authenticateRequest", () => {
  test("throws AuthError with 401 when auth header is missing", async () => {
    const config: AuthMiddlewareConfig = { verify: successVerify() };

    try {
      await authenticateRequest(undefined, config);
      throw new Error("Expected authenticateRequest to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      const authErr = err as AuthError;
      expect(authErr.status).toBe(401);
      expect(authErr.code).toBe("missing_token");
      expect(authErr.message).toContain("Authorization header");
    }
  });

  test("throws AuthError with 401 when verify rejects", async () => {
    const config: AuthMiddlewareConfig = { verify: failVerify("bad signature") };

    try {
      await authenticateRequest("Bearer bad-token", config);
      throw new Error("Expected authenticateRequest to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      const authErr = err as AuthError;
      expect(authErr.status).toBe(401);
      expect(authErr.code).toBe("invalid_token");
      expect(authErr.message).toContain("bad signature");
    }
  });

  test("returns AuthenticatedUser on successful verification", async () => {
    const config: AuthMiddlewareConfig = { verify: successVerify() };
    const user = await authenticateRequest("Bearer my-token", config);

    expect(user.sub).toBe("user-123");
    expect(user.address).toBe("user-123"); // Falls back to sub
    expect(user.claims).toBeDefined();
    expect(user.claims.sub).toBe("user-123");
  });

  test("uses claims.address when present", async () => {
    const config: AuthMiddlewareConfig = {
      verify: successVerify({ address: "0xABC123" }),
    };
    const user = await authenticateRequest("Bearer token", config);

    expect(user.address).toBe("0xABC123");
    expect(user.sub).toBe("user-123");
  });

  test("ignores empty claims.address and falls back to sub", async () => {
    const config: AuthMiddlewareConfig = {
      verify: successVerify({ address: "" }),
    };
    const user = await authenticateRequest("Bearer token", config);

    expect(user.address).toBe("user-123");
  });

  test("uses custom resolveAddress when provided", async () => {
    const config: AuthMiddlewareConfig = {
      verify: successVerify({ address: "0xShouldBeIgnored" }),
      resolveAddress: async (claims) => `custom-${claims.sub}`,
    };
    const user = await authenticateRequest("Bearer token", config);

    expect(user.address).toBe("custom-user-123");
  });

  test("uses synchronous resolveAddress", async () => {
    const config: AuthMiddlewareConfig = {
      verify: successVerify(),
      resolveAddress: (claims) => `sync-${claims.sub}`,
    };
    const user = await authenticateRequest("Bearer token", config);

    expect(user.address).toBe("sync-user-123");
  });

  test("fetches address from userinfo when openKeyUrl is set and no address claim", async () => {
    // Mock global fetch for the userinfo call
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ sub: "user-123", address: "0xFromUserInfo" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      const config: AuthMiddlewareConfig = {
        verify: successVerify(),
        openKeyUrl: "https://openkey.so",
      };
      const user = await authenticateRequest("Bearer token", config);

      expect(user.address).toBe("0xFromUserInfo");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to sub when userinfo has no address", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ sub: "user-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      const config: AuthMiddlewareConfig = {
        verify: successVerify(),
        openKeyUrl: "https://openkey.so",
      };
      const user = await authenticateRequest("Bearer token", config);

      expect(user.address).toBe("user-123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("resolveAddress takes precedence over claims.address and openKeyUrl", async () => {
    const config: AuthMiddlewareConfig = {
      verify: successVerify({ address: "0xFromClaims" }),
      openKeyUrl: "https://openkey.so",
      resolveAddress: () => "0xCustom",
    };
    const user = await authenticateRequest("Bearer token", config);

    expect(user.address).toBe("0xCustom");
  });

  test("claims.address takes precedence over openKeyUrl fetch", async () => {
    // Should NOT call fetch since claims.address is present
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ sub: "user-123", address: "0xFromFetch" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const config: AuthMiddlewareConfig = {
        verify: successVerify({ address: "0xFromClaims" }),
        openKeyUrl: "https://openkey.so",
      };
      const user = await authenticateRequest("Bearer token", config);

      expect(user.address).toBe("0xFromClaims");
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── AuthError ────────────────────────────────────────────────────────

describe("AuthError", () => {
  test("has correct properties", () => {
    const err = new AuthError(403, "forbidden", "Not allowed");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.name).toBe("AuthError");
    expect(err.status).toBe(403);
    expect(err.code).toBe("forbidden");
    expect(err.message).toBe("Not allowed");
  });
});

// ── createAuthMiddleware ─────────────────────────────────────────────

describe("createAuthMiddleware", () => {
  test("attaches user to req and calls next on success", async () => {
    const middleware = createAuthMiddleware({ verify: successVerify() });

    const req = mockReq({ authorization: "Bearer good-token" });
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    const user = req.user as AuthenticatedUser;
    expect(user.sub).toBe("user-123");
    expect(user.address).toBe("user-123");
    expect(user.claims.sub).toBe("user-123");
  });

  test("returns 401 JSON when authorization header is missing", async () => {
    const middleware = createAuthMiddleware({ verify: successVerify() });

    const req = mockReq({});
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
    expect((res._body as any).error).toBe("missing_token");
    expect((res._body as any).message).toContain("Authorization header");
  });

  test("returns 401 JSON when token verification fails", async () => {
    const middleware = createAuthMiddleware({
      verify: failVerify("expired token"),
    });

    const req = mockReq({ authorization: "Bearer expired" });
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
    expect((res._body as any).error).toBe("invalid_token");
    expect((res._body as any).message).toContain("expired token");
  });

  test("returns generic 401 for unexpected errors", async () => {
    const middleware = createAuthMiddleware({
      verify: async () => {
        throw "unexpected string error";
      },
    });

    const req = mockReq({ authorization: "Bearer something" });
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res._status).toBe(401);
    // The verify throws a string, so authenticateRequest wraps it in AuthError
    expect((res._body as any).error).toBe("invalid_token");
  });

  test("works with claims.address for address resolution", async () => {
    const middleware = createAuthMiddleware({
      verify: successVerify({ address: "0xWallet" }),
    });

    const req = mockReq({ authorization: "Bearer token" });
    const res = mockRes();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect((req.user as AuthenticatedUser).address).toBe("0xWallet");
  });

  test("works with resolveAddress for custom resolution", async () => {
    const middleware = createAuthMiddleware({
      verify: successVerify(),
      resolveAddress: (claims) => `resolved-${claims.sub}`,
    });

    const req = mockReq({ authorization: "Bearer token" });
    const res = mockRes();

    await middleware(req, res, () => {});

    expect((req.user as AuthenticatedUser).address).toBe("resolved-user-123");
  });

  test("does not call next after sending error response", async () => {
    const middleware = createAuthMiddleware({ verify: failVerify() });

    const req = mockReq({ authorization: "Bearer bad" });
    const res = mockRes();
    let nextCallCount = 0;

    await middleware(req, res, () => {
      nextCallCount++;
    });

    expect(nextCallCount).toBe(0);
    expect(res._status).toBe(401);
  });
});

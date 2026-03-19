import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  createHealthCheck,
  createHealthEndpoint,
  type HealthCheckConfig,
  type HealthResult,
} from "../health.js";
import { noopLogger } from "@tinyboilerplate/core";

// ── Helpers ──────────────────────────────────────────────────────────

function createMockNode(overrides?: { did?: string; kvListFails?: boolean }) {
  return {
    did: overrides?.did ?? "did:pkh:eip155:1:0xABC",
    kv: {
      list: overrides?.kvListFails
        ? mock(() => Promise.reject(new Error("KV unreachable")))
        : mock(() => Promise.resolve({ data: { items: [] } })),
    },
    signIn: mock(() => Promise.resolve()),
  };
}

function makeConfig(
  overrides?: Partial<HealthCheckConfig> & {
    mockNode?: ReturnType<typeof createMockNode>;
  },
): HealthCheckConfig {
  const mockNode = overrides?.mockNode ?? createMockNode();
  return {
    node: mockNode as any,
    did: overrides?.did ?? "did:pkh:eip155:1:0xABC",
    openKeyIssuerUrl: overrides?.openKeyIssuerUrl ?? "https://openkey.example.com",
    timeoutMs: overrides?.timeoutMs ?? 2_000,
    checkKV: overrides?.checkKV ?? false,
    logger: overrides?.logger ?? noopLogger,
  };
}

/** Mock response that captures status and body. */
function mockRes() {
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

// ── createHealthCheck ────────────────────────────────────────────────

describe("createHealthCheck", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns healthy when identity is active and JWKS is reachable", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;

    const check = createHealthCheck(makeConfig());
    const result = await check();

    expect(result.status).toBe("healthy");
    expect(result.checks.identity.status).toBe("pass");
    expect(result.checks.jwks.status).toBe("pass");
    expect(result.checks.kv).toBeUndefined();
    expect(result.timestamp).toBeTruthy();
  });

  test("returns healthy with all checks including KV", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;

    const check = createHealthCheck(makeConfig({ checkKV: true }));
    const result = await check();

    expect(result.status).toBe("healthy");
    expect(result.checks.identity.status).toBe("pass");
    expect(result.checks.jwks.status).toBe("pass");
    expect(result.checks.kv).toBeDefined();
    expect(result.checks.kv!.status).toBe("pass");
  });

  test("returns unhealthy when DID is empty", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;

    const check = createHealthCheck(makeConfig({ did: "" }));
    const result = await check();

    expect(result.status).toBe("unhealthy");
    expect(result.checks.identity.status).toBe("fail");
    expect(result.checks.identity.error).toContain("not set");
  });

  test("returns unhealthy when node.did is empty", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;

    const mockNode = createMockNode({ did: "" });
    const check = createHealthCheck(makeConfig({ mockNode, did: "did:pkh:eip155:1:0xABC" }));
    const result = await check();

    expect(result.status).toBe("unhealthy");
    expect(result.checks.identity.status).toBe("fail");
    expect(result.checks.identity.error).toContain("no active DID");
  });

  test("returns degraded when JWKS endpoint returns non-200", async () => {
    globalThis.fetch = mock(async () => new Response("Not Found", { status: 404 })) as any;

    const check = createHealthCheck(makeConfig());
    const result = await check();

    expect(result.status).toBe("degraded");
    expect(result.checks.identity.status).toBe("pass");
    expect(result.checks.jwks.status).toBe("fail");
    expect(result.checks.jwks.error).toContain("404");
  });

  test("returns degraded when JWKS fetch throws (network error)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;

    const check = createHealthCheck(makeConfig());
    const result = await check();

    expect(result.status).toBe("degraded");
    expect(result.checks.jwks.status).toBe("fail");
    expect(result.checks.jwks.error).toContain("ECONNREFUSED");
  });

  test("returns degraded when KV check fails", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;

    const mockNode = createMockNode({ kvListFails: true });
    const check = createHealthCheck(makeConfig({ checkKV: true, mockNode }));
    const result = await check();

    expect(result.status).toBe("degraded");
    expect(result.checks.identity.status).toBe("pass");
    expect(result.checks.jwks.status).toBe("pass");
    expect(result.checks.kv!.status).toBe("fail");
    expect(result.checks.kv!.error).toContain("KV unreachable");
  });

  test("KV check is skipped when checkKV is false", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;

    const check = createHealthCheck(makeConfig({ checkKV: false }));
    const result = await check();

    expect(result.checks.kv).toBeUndefined();
  });

  test("all checks include latencyMs", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;

    const check = createHealthCheck(makeConfig({ checkKV: true }));
    const result = await check();

    expect(typeof result.checks.identity.latencyMs).toBe("number");
    expect(result.checks.identity.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.checks.jwks.latencyMs).toBe("number");
    expect(result.checks.jwks.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.checks.kv!.latencyMs).toBe("number");
    expect(result.checks.kv!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("identity failure takes precedence over JWKS failure", async () => {
    globalThis.fetch = mock(
      async () => new Response("Internal Server Error", { status: 500 }),
    ) as any;

    const check = createHealthCheck(makeConfig({ did: "" }));
    const result = await check();

    // Both fail, but status should be unhealthy (identity) not degraded (jwks)
    expect(result.status).toBe("unhealthy");
    expect(result.checks.identity.status).toBe("fail");
    expect(result.checks.jwks.status).toBe("fail");
  });

  test("constructs correct JWKS URL from issuer", async () => {
    let fetchedUrl = "";
    globalThis.fetch = mock(async (input: any) => {
      fetchedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    }) as any;

    const check = createHealthCheck(makeConfig({ openKeyIssuerUrl: "https://auth.example.com" }));
    await check();

    expect(fetchedUrl).toBe("https://auth.example.com/api/auth/jwks");
  });
});

// ── createHealthEndpoint ─────────────────────────────────────────────

describe("createHealthEndpoint", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("responds 200 for healthy status", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }),
    ) as any;

    const endpoint = createHealthEndpoint(makeConfig());
    const res = mockRes();

    await endpoint({}, res);

    expect(res._status).toBe(200);
    const body = res._body as HealthResult;
    expect(body.status).toBe("healthy");
  });

  test("responds 200 for degraded status", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("timeout");
    }) as any;

    const endpoint = createHealthEndpoint(makeConfig());
    const res = mockRes();

    await endpoint({}, res);

    expect(res._status).toBe(200);
    const body = res._body as HealthResult;
    expect(body.status).toBe("degraded");
  });

  test("responds 503 for unhealthy status", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }),
    ) as any;

    const endpoint = createHealthEndpoint(makeConfig({ did: "" }));
    const res = mockRes();

    await endpoint({}, res);

    expect(res._status).toBe(503);
    const body = res._body as HealthResult;
    expect(body.status).toBe("unhealthy");
  });
});

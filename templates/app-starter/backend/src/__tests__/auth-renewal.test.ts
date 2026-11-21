import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import { createNonceStore } from "@tinyboilerplate/server";
import { createAuthRouter } from "../routes/auth.js";

// The route's gates, ahead of the crypto checks in packages/server (verifyRenewal) that packages/client/test covers
// with real signatures and a loopback node.

const ADDRESS = "0x" + "ab".repeat(20);
const servers: Array<ReturnType<ReturnType<typeof express>["listen"]>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

async function backend(renewal?: Parameters<typeof createAuthRouter>[0]["renewal"]) {
  const nonceStore = createNonceStore();
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({ nonceStore, privateKey: "test-key", renewal }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  return {
    nonceStore,
    async post(body: unknown) {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/verify-renewal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
  };
}

const config = {
  backendOrigin: "https://api.example.com",
  nodeOrigin: "https://node.example.com",
  nodeDid: "did:key:node",
  renewerDid: "did:key:renewer",
};

function request(nonce: string) {
  return {
    address: ADDRESS,
    nonce,
    delegation: { message: "m", signature: "0x00", delegationCid: "cid" },
    leaseAuthorization: "lease",
    holderProof: "proof",
    statusInvocation: "invocation",
  };
}

describe("POST /api/auth/verify-renewal", () => {
  test("without renewal config it answers 503 and leaves the nonce unused, so the sign-in stays finite", async () => {
    const api = await backend();
    const nonce = api.nonceStore.generate(ADDRESS);
    expect(await api.post(request(nonce))).toEqual({
      status: 503,
      body: { error: "renewal_unavailable" },
    });
    expect(api.nonceStore.validate(ADDRESS, nonce)).toBe(true);
  });

  test("a malformed body is refused with 400", async () => {
    const api = await backend(config);
    expect((await api.post({ address: ADDRESS })).status).toBe(400);
    expect((await api.post({ ...request("n"), address: "not-an-address" })).status).toBe(400);
  });

  test("an unknown nonce is refused before anything is checked", async () => {
    const api = await backend(config);
    expect(await api.post(request("never-issued"))).toEqual({
      status: 401,
      body: { error: "invalid_nonce" },
    });
  });

  test("a nonce is spent by the attempt, even one whose proofs fail", async () => {
    const api = await backend(config);
    const nonce = api.nonceStore.generate(ADDRESS);
    const first = await api.post(request(nonce));
    expect(first.status).toBe(401);
    expect(first.body.error).not.toBe("invalid_nonce");
    expect(await api.post(request(nonce))).toEqual({
      status: 401,
      body: { error: "invalid_nonce" },
    });
  });
});

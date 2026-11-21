import { afterEach, describe, expect, test } from "bun:test";
import express from "express";
import { createNonceStore } from "@tinyboilerplate/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAuthRouter } from "../routes/auth.js";

// POST /api/auth/verify issues a bearer only for a grant meant for this app: its SIWE domain is the frontend's host.

const FRONTEND = "https://app.example.com";
const SESSION_KEY = "did:key:z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp9WxWufuXSdxf";
const servers: Array<ReturnType<ReturnType<typeof express>["listen"]>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

async function backend() {
  const nonceStore = createNonceStore();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({ nonceStore, privateKey: "test-key", frontendUrl: FRONTEND }),
  );
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  return {
    nonceStore,
    async verify(body: unknown) {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
  };
}

async function attempt(domain: string, uri: string) {
  const api = await backend();
  const owner = privateKeyToAccount(generatePrivateKey());
  const nonce = api.nonceStore.generate(owner.address);
  const message = [
    `${domain} wants you to sign in with your Ethereum account:`,
    owner.address,
    "",
    "Sign in.",
    "",
    `URI: ${uri}`,
    "Version: 1",
    "Chain ID: 1",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
    `Expiration Time: ${new Date(Date.now() + 3_600_000).toISOString()}`,
  ].join("\n");
  const signature = await owner.signMessage({ message });
  return { owner, result: await api.verify({ message, signature }) };
}

describe("POST /api/auth/verify", () => {
  test("refuses a grant whose SIWE domain belongs to another app", async () => {
    const { result } = await attempt("other-app.example.org", SESSION_KEY);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_origin");
  });

  test("refuses a grant whose URI is another app's origin", async () => {
    const { result } = await attempt("app.example.com", "https://other-app.example.org");
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_origin");
  });

  test("issues a bearer for a grant naming this app's host, with a session key or its own origin as URI", async () => {
    for (const uri of [SESSION_KEY, FRONTEND]) {
      const { result, owner } = await attempt("app.example.com", uri);
      expect(result.status).toBe(200);
      expect(typeof result.body.token).toBe("string");
      expect(result.body.address).toBe(owner.address.toLowerCase());
    }
  });
});

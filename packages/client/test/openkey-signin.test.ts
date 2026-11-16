import { describe, expect, test } from "bun:test";
import { createAndSignIn } from "../src/tinycloud.js";

const ADDRESS = "0x1111111111111111111111111111111111111111";

// Only the address is read from the provider: the session is signed by OpenKey's approval.
const provider = {
  request: async ({ method }: { method: string }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [ADDRESS];
    if (method === "eth_chainId") return "0x1";
    throw new Error(`unexpected provider call: ${method}`);
  },
  on() {},
  removeListener() {},
};

type SignInConfig = Parameters<typeof createAndSignIn>[1];
type AuthorizeRequest = { protocolVersion: number; siwe: string; host: string };

function declinedOpenKey() {
  const requests: Array<{ request: AuthorizeRequest; opts: { mode?: string } }> = [];
  const client = {
    authorizeTinyCloud: async (request: AuthorizeRequest, opts: { mode?: string }) => {
      requests.push({ request, opts });
      throw new Error("User declined the request");
    },
  } as unknown as SignInConfig["openkey"]["client"];
  return { client, requests };
}

describe("createAndSignIn through OpenKey", () => {
  test("asks OpenKey for a versioned approval of the session SIWE, bound to the backend nonce", async () => {
    const { client, requests } = declinedOpenKey();

    await createAndSignIn(provider, {
      address: ADDRESS,
      nonce: "0123456789abcdef0123456789abcdef",
      tinycloudHosts: ["https://node.example"],
      openkey: { client, mode: "iframe" },
    }).catch(() => {});

    expect(requests).toHaveLength(1);
    const { request, opts } = requests[0]!;
    expect(request.protocolVersion).toBe(1);
    expect(request.siwe).toContain(`Nonce: 0123456789abcdef0123456789abcdef`);
    expect(request.host).toBe("https://node.example");
    expect(opts.mode).toBe("iframe");
  });

  test("a declined approval rejects with OpenKey's error", async () => {
    const { client } = declinedOpenKey();

    await expect(
      createAndSignIn(provider, {
        address: ADDRESS,
        nonce: "fedcba9876543210fedcba9876543210",
        tinycloudHosts: ["https://node.example"],
        openkey: { client, mode: "iframe" },
      }),
    ).rejects.toThrow("User declined the request");
  });
});

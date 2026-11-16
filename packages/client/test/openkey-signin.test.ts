import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PrivateKeySigner } from "@tinycloud/node-sdk";
import {
  composeManifestRequest,
  extractRecapAttenuations,
  parseCanonicalRecapResource,
  type Manifest,
} from "@tinycloud/sdk-core";
import { loadPersistedSession } from "../src/session-persistence.js";
import { createAndSignIn } from "../src/tinycloud.js";

// These tests drive the real web-sdk. They run in their own bun process (`bun test ./test`)
// because src/__tests__/tinycloud.test.ts mocks "@tinycloud/web-sdk" for the whole process.

type SignInConfig = Parameters<typeof createAndSignIn>[1];
type AuthorizeRequest = { protocolVersion: number; siwe: string; host: string };
type Authorize = (request: AuthorizeRequest, opts: { mode?: string }) => Promise<unknown>;

const NONCE = "0123456789abcdef0123456789abcdef";
const signer = new PrivateKeySigner("1".padStart(64, "0"));
const address = await signer.getAddress();

// Only the address is read from the provider: the session is signed by OpenKey's approval.
const provider = {
  request: async ({ method }: { method: string }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
    if (method === "eth_chainId") return "0x1";
    throw new Error(`unexpected provider call: ${method}`);
  },
  on() {},
  removeListener() {},
};

const manifest: Manifest = {
  manifest_version: 1,
  app_id: "com.example.notes",
  name: "Example Notes",
  defaults: false,
  permissions: [
    {
      service: "tinycloud.kv",
      path: "entries/",
      actions: ["get", "put", "del", "list"],
      description: "Store note body content by note id.",
    },
    {
      service: "tinycloud.sql",
      path: "notes_index",
      actions: ["read", "write"],
      description: "Store note metadata.",
    },
  ],
};

function openkeyClient(authorizeTinyCloud: Authorize) {
  return { authorizeTinyCloud } as unknown as SignInConfig["openkey"]["client"];
}

function signInConfig(authorize: Authorize): SignInConfig {
  return {
    address,
    nonce: NONCE,
    tinycloudHosts: ["https://node.example"],
    capabilityRequest: composeManifestRequest([manifest]),
    openkey: { client: openkeyClient(authorize), mode: "iframe" },
  };
}

/** What OpenKey returns once the owner approves the SIWE it was shown, possibly narrowed. */
async function approve(siwe: string) {
  const attenuations = extractRecapAttenuations(siwe);
  const selectedActionKeys: string[] = [];
  const permissions: Array<{ service: string; space: string; path: string; actions: string[] }> =
    [];
  for (const [resource, abilities] of Object.entries(attenuations)) {
    const { space, path } = parseCanonicalRecapResource(resource);
    const actions = Object.keys(abilities);
    permissions.push({ service: actions[0]!.split("/")[0]!, space, path, actions });
    for (const action of actions) {
      if (action === "tinycloud.capabilities/read") continue;
      selectedActionKeys.push(`${action.split("/")[0]}\0${space}\0${path}\0${action}`);
    }
  }
  return {
    protocolVersion: 1,
    address,
    signature: await signer.signMessage(siwe),
    signedMessage: siwe,
    selectedActionKeys,
    permissions,
  };
}

/** The owner unticks the SQL permission: its ReCap entry leaves the SIWE they sign. */
function withoutSql(siwe: string): string {
  const lines = siwe.split("\n");
  const index = lines.findIndex((line) => line.startsWith("- urn:recap:"));
  const recap = JSON.parse(
    Buffer.from(lines[index]!.slice("- urn:recap:".length), "base64url").toString(),
  );
  for (const resource of Object.keys(recap.att)) {
    if (Object.keys(recap.att[resource]).some((ability) => ability.startsWith("tinycloud.sql/"))) {
      delete recap.att[resource];
    }
  }
  lines[index] = `- urn:recap:${Buffer.from(JSON.stringify(recap)).toString("base64url")}`;
  return lines.join("\n");
}

const realFetch = globalThis.fetch;
const realLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  // The node answers /info, and every delegation activation succeeds.
  globalThis.fetch = (async (input: string | URL | Request) => {
    const body = String(input).endsWith("/info")
      ? { protocol: 1, version: "1.0.0", features: [] }
      : { activated: [], skipped: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realLocalStorage) Object.defineProperty(globalThis, "localStorage", realLocalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("createAndSignIn through OpenKey", () => {
  test("asks OpenKey for a versioned approval of the session SIWE, bound to the backend nonce", async () => {
    const requests: Array<{ request: AuthorizeRequest; opts: { mode?: string } }> = [];

    await createAndSignIn(
      provider,
      signInConfig(async (request, opts) => {
        requests.push({ request, opts });
        throw new Error("User declined the request");
      }),
    ).catch(() => {});

    expect(requests).toHaveLength(1);
    const { request, opts } = requests[0]!;
    expect(request.protocolVersion).toBe(1);
    expect(request.siwe).toContain(`Nonce: ${NONCE}`);
    expect(request.host).toBe("https://node.example");
    expect(opts.mode).toBe("iframe");
  });

  test("a declined approval rejects with OpenKey's error", async () => {
    await expect(
      createAndSignIn(
        provider,
        signInConfig(async () => {
          throw new Error("User declined the request");
        }),
      ),
    ).rejects.toThrow("User declined the request");
  });

  test("an approval of everything requested signs in and keeps the session", async () => {
    const { session } = await createAndSignIn(
      provider,
      signInConfig(async (request) => approve(request.siwe)),
    );

    expect(session.address.toLowerCase()).toBe(address.toLowerCase());
    expect(loadPersistedSession(address)).not.toBeNull();
  });

  test("an approval the owner narrowed is refused in plain words and leaves no session", async () => {
    await expect(
      createAndSignIn(
        provider,
        signInConfig(async (request) => approve(withoutSql(request.siwe))),
      ),
    ).rejects.toThrow(
      "Example Notes needs these permissions to work: Store note body content by note id. Store note metadata. Sign in again and keep all permissions.",
    );

    expect(loadPersistedSession(address)).toBeNull();
  });
});

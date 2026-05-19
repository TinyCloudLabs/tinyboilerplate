import { describe, expect, mock, test } from "bun:test";

let lastTinyCloudConfig: any = null;
let lastRestoreAddress: string | undefined;
let lastCleanupCalled = false;
let restoreResult: any = { status: "restored", session: { address: "0xabc" } };

mock.module("@tinycloud/web-sdk", () => ({
  BrowserSessionStorage: class BrowserSessionStorage {},
  TinyCloudWeb: class TinyCloudWeb {
    provider: unknown;

    constructor(config: any) {
      lastTinyCloudConfig = config;
    }

    async restoreSession(address?: string) {
      lastRestoreAddress = address;
      return restoreResult;
    }

    cleanup() {
      lastCleanupCalled = true;
    }
  },
}));

const { createTinyCloudWeb, restoreTinyCloudWebSession } = await import("../tinycloud.js");

describe("createTinyCloudWeb", () => {
  test("uses the current provider option and stores composed request manifests", () => {
    const manifests = [
      {
        manifest_version: 1,
        app_id: "com.example.app",
        name: "Example App",
        permissions: [],
      },
    ];
    const capabilityRequest = {
      manifests,
      resources: [],
      delegationTargets: [],
    };
    const provider = { request: async () => null } as any;

    const tcw = createTinyCloudWeb(provider, { capabilityRequest });

    expect(lastTinyCloudConfig.capabilityRequest).toBe(capabilityRequest);
    expect(lastTinyCloudConfig.manifest).toBe(manifests);
    expect(lastTinyCloudConfig.provider).toBe(provider);
    expect(lastTinyCloudConfig.providers).toBeUndefined();
    expect((tcw as any).provider).toBeUndefined();
  });

  test("preserves an explicit manifest over composed request manifests", () => {
    const explicitManifest = {
      manifest_version: 1,
      app_id: "com.example.explicit",
      name: "Explicit",
      permissions: [],
    };
    const capabilityRequest = {
      manifests: [
        {
          manifest_version: 1,
          app_id: "com.example.composed",
          name: "Composed",
          permissions: [],
        },
      ],
      resources: [],
      delegationTargets: [],
    };

    createTinyCloudWeb({ request: async () => null } as any, {
      manifest: explicitManifest,
      capabilityRequest,
    });

    expect(lastTinyCloudConfig.manifest).toBe(explicitManifest);
  });
});

describe("restoreTinyCloudWebSession", () => {
  test("restores a session-only TinyCloudWeb without a provider", async () => {
    restoreResult = { status: "restored", session: { address: "0xabc" } };
    lastRestoreAddress = undefined;
    lastCleanupCalled = false;

    const result = await restoreTinyCloudWebSession("0xabc", {
      tinycloudHosts: ["https://node.example"],
    });

    expect(result.status).toBe("restored");
    expect(result.tcw).not.toBeNull();
    expect(lastRestoreAddress).toBe("0xabc");
    expect(lastCleanupCalled).toBe(false);
    expect(lastTinyCloudConfig.provider).toBeUndefined();
    expect(lastTinyCloudConfig.providers).toBeUndefined();
    expect(lastTinyCloudConfig.autoCreateSpace).toBe(false);
    expect(lastTinyCloudConfig.tinycloudHosts).toEqual(["https://node.example"]);
    expect(lastTinyCloudConfig.sessionStorage.constructor.name).toBe("BrowserSessionStorage");
  });

  test("cleans up and returns backend-only state when direct restore is unavailable", async () => {
    restoreResult = { status: "missing" };
    lastRestoreAddress = undefined;
    lastCleanupCalled = false;

    const result = await restoreTinyCloudWebSession("0xabc");

    expect(result.status).toBe("missing");
    expect(result.tcw).toBeNull();
    expect(lastRestoreAddress).toBe("0xabc");
    expect(lastCleanupCalled).toBe(true);
  });
});

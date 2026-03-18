import { describe, test, expect, mock, beforeEach } from "bun:test";
import { signOut, type SignOutConfig } from "../sign-out.js";
import type { ApiClient } from "../api.js";
import type { TokenStore } from "../tokens.js";

// ── Mock factories ──────────────────────────────────────────────────

function createMockApiClient(): ApiClient {
  return {
    get: mock(() => Promise.resolve({})),
    post: mock(() => Promise.resolve({})),
    put: mock(() => Promise.resolve({})),
    patch: mock(() => Promise.resolve({})),
    del: mock(() => Promise.resolve(undefined)),
  };
}

function createMockTokenStore(): TokenStore {
  return {
    setTokens: mock(() => {}),
    getAccessToken: mock(() => "test-token"),
    getRefreshToken: mock(() => "test-refresh"),
    hasTokens: mock(() => true),
    isExpired: mock(() => false),
    clear: mock(() => {}),
    restore: mock(() => true),
    refresh: mock(() => Promise.resolve()),
  } as unknown as TokenStore;
}

function createMockTcw() {
  return {
    signOut: mock(() => {}),
  };
}

function createMockOpenKey() {
  return {
    disconnect: mock(() => {}),
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("signOut", () => {
  test("returns empty array when all steps succeed", async () => {
    const api = createMockApiClient();
    const tokenStore = createMockTokenStore();
    const tcw = createMockTcw();
    const openkey = createMockOpenKey();

    const errors = await signOut({
      api,
      tokenStore,
      tcw: tcw as any,
      openkey: openkey as any,
    });

    expect(errors).toEqual([]);
  });

  test("calls all steps in order when all provided", async () => {
    const callOrder: string[] = [];

    const api = createMockApiClient();
    (api.del as any).mockImplementation(async () => {
      callOrder.push("revokeDelegation");
    });

    const tcw = {
      signOut: mock(() => {
        callOrder.push("tcw.signOut");
      }),
    };

    const tokenStore = createMockTokenStore();
    (tokenStore.clear as any).mockImplementation(() => {
      callOrder.push("tokenStore.clear");
    });

    const openkey = {
      disconnect: mock(() => {
        callOrder.push("openkey.disconnect");
      }),
    };

    await signOut({
      api,
      tcw: tcw as any,
      tokenStore,
      openkey: openkey as any,
    });

    expect(callOrder).toEqual([
      "revokeDelegation",
      "tcw.signOut",
      "tokenStore.clear",
      "openkey.disconnect",
    ]);
  });

  test("delegation revoke happens before tokens are cleared", async () => {
    const callOrder: string[] = [];

    const api = createMockApiClient();
    (api.del as any).mockImplementation(async () => {
      callOrder.push("revokeDelegation");
    });

    const tokenStore = createMockTokenStore();
    (tokenStore.clear as any).mockImplementation(() => {
      callOrder.push("tokenStore.clear");
    });

    await signOut({ api, tokenStore });

    const revokeIndex = callOrder.indexOf("revokeDelegation");
    const clearIndex = callOrder.indexOf("tokenStore.clear");
    expect(revokeIndex).toBeLessThan(clearIndex);
  });

  test("continues when delegation revoke fails", async () => {
    const api = createMockApiClient();
    (api.del as any).mockImplementation(async () => {
      throw new Error("Network error");
    });

    const tokenStore = createMockTokenStore();
    const tcw = createMockTcw();

    const errors = await signOut({
      api,
      tokenStore,
      tcw: tcw as any,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Failed to revoke delegation");
    expect(errors[0].cause).toBeInstanceOf(Error);

    // Other steps should still have been called
    expect(tcw.signOut).toHaveBeenCalledTimes(1);
    expect(tokenStore.clear).toHaveBeenCalledTimes(1);
  });

  test("continues when TinyCloud signOut fails", async () => {
    const tcw = {
      signOut: mock(() => {
        throw new Error("TC signOut failed");
      }),
    };

    const tokenStore = createMockTokenStore();

    const errors = await signOut({
      tcw: tcw as any,
      tokenStore,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Failed to sign out of TinyCloud");

    // Token clear should still happen
    expect(tokenStore.clear).toHaveBeenCalledTimes(1);
  });

  test("continues when OpenKey disconnect fails", async () => {
    const openkey = {
      disconnect: mock(() => {
        throw new Error("OpenKey disconnect failed");
      }),
    };

    const tokenStore = createMockTokenStore();

    const errors = await signOut({
      tokenStore,
      openkey: openkey as any,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Failed to disconnect OpenKey");

    // Token clear should have happened before openkey disconnect
    expect(tokenStore.clear).toHaveBeenCalledTimes(1);
  });

  test("collects multiple errors", async () => {
    const api = createMockApiClient();
    (api.del as any).mockImplementation(async () => {
      throw new Error("Revoke failed");
    });

    const tcw = {
      signOut: mock(() => {
        throw new Error("TC failed");
      }),
    };

    const openkey = {
      disconnect: mock(() => {
        throw new Error("OpenKey failed");
      }),
    };

    const errors = await signOut({
      api,
      tcw: tcw as any,
      openkey: openkey as any,
    });

    expect(errors).toHaveLength(3);
    expect(errors[0].message).toBe("Failed to revoke delegation");
    expect(errors[1].message).toBe("Failed to sign out of TinyCloud");
    expect(errors[2].message).toBe("Failed to disconnect OpenKey");
  });

  test("does nothing with empty config", async () => {
    const errors = await signOut({});
    expect(errors).toEqual([]);
  });

  test("only calls provided steps", async () => {
    const tokenStore = createMockTokenStore();

    const errors = await signOut({ tokenStore });

    expect(errors).toEqual([]);
    expect(tokenStore.clear).toHaveBeenCalledTimes(1);
  });

  test("handles tcw without signOut method gracefully", async () => {
    // Some TinyCloudWeb instances might not have signOut
    const tcw = {} as any;

    const errors = await signOut({ tcw });

    // signOut uses optional chaining, so no error
    expect(errors).toEqual([]);
  });

  test("handles openkey without disconnect method gracefully", async () => {
    // Edge case: OpenKey instance without disconnect
    const openkey = {} as any;

    const errors = await signOut({ openkey });

    // disconnect uses optional chaining, so no error
    expect(errors).toEqual([]);
  });
});

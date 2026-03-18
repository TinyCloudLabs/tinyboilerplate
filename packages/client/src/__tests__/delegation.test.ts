import { describe, test, expect, mock } from "bun:test";
import { sendDelegation, checkDelegationStatus, revokeDelegation } from "../delegation.js";
import type { ApiClient } from "../api.js";

function createMockApiClient(): ApiClient {
  return {
    get: mock(() => Promise.resolve({ status: "active", expiresAt: "2026-12-31" })),
    post: mock(() => Promise.resolve({ status: "active", expiresAt: "2026-12-31" })),
    put: mock(() => Promise.resolve({})),
    del: mock(() => Promise.resolve(undefined)),
  };
}

describe("sendDelegation", () => {
  test("calls api.post with serialized delegation", async () => {
    const api = createMockApiClient();
    const result = await sendDelegation(api, "serialized-data");

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/api/delegations", { serialized: "serialized-data" });
    expect(result).toEqual({ status: "active", expiresAt: "2026-12-31" });
  });
});

describe("checkDelegationStatus", () => {
  test("calls api.get on status endpoint", async () => {
    const api = createMockApiClient();
    const result = await checkDelegationStatus(api);

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith("/api/delegations/status");
    expect(result).toEqual({ status: "active", expiresAt: "2026-12-31" });
  });
});

describe("revokeDelegation", () => {
  test("calls api.del on delegations endpoint", async () => {
    const api = createMockApiClient();
    await revokeDelegation(api);

    expect(api.del).toHaveBeenCalledTimes(1);
    expect(api.del).toHaveBeenCalledWith("/api/delegations");
  });
});

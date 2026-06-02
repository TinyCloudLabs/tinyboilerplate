import { describe, expect, it } from "bun:test";
import { APP_ID } from "../manifest.js";
import { APP_STARTER_BACKEND_KV_PREFIX, appStarterBackendIdentityConfig } from "../startup.js";

describe("app starter backend startup config", () => {
  it("uses an app-specific backend-owned KV prefix for operational state", () => {
    expect(APP_STARTER_BACKEND_KV_PREFIX).toBe(`${APP_ID}-backend`);
    expect(APP_STARTER_BACKEND_KV_PREFIX).toBe("xyz.tinycloud.app-starter-backend");
    expect(APP_STARTER_BACKEND_KV_PREFIX).not.toContain("/");
    expect(APP_STARTER_BACKEND_KV_PREFIX).not.toBe("boilerplate-be");

    expect(
      appStarterBackendIdentityConfig({
        privateKey: "0xabc",
        host: "https://node.example",
      }),
    ).toEqual({
      privateKey: "0xabc",
      host: "https://node.example",
      prefix: APP_STARTER_BACKEND_KV_PREFIX,
    });
  });
});

import { describe, expect, it } from "bun:test";
import { APP_ID } from "../manifest.js";
import { NOTES_BACKEND_KV_PREFIX, notesBackendIdentityConfig } from "../startup.js";

describe("Notes backend startup config", () => {
  it("uses an app-specific backend-owned KV prefix for operational state", () => {
    expect(NOTES_BACKEND_KV_PREFIX).toBe(`${APP_ID}-backend`);
    expect(NOTES_BACKEND_KV_PREFIX).not.toContain("/");
    expect(NOTES_BACKEND_KV_PREFIX).not.toBe("boilerplate-be");

    expect(
      notesBackendIdentityConfig({
        privateKey: "0xabc",
        host: "https://node.example",
      }),
    ).toEqual({
      privateKey: "0xabc",
      host: "https://node.example",
      prefix: NOTES_BACKEND_KV_PREFIX,
    });
  });
});

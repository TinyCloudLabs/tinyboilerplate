import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { fetchUserInfo } from "../auth.js";

describe("fetchUserInfo", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("throws sanitized error on non-ok response", async () => {
    globalThis.fetch = (async () =>
      new Response("Not Found", { status: 404 })) as typeof fetch;
    await expect(
      fetchUserInfo("https://example.com", "bad-token"),
    ).rejects.toThrow("Failed to fetch user info (404): Not Found");
  });

  test("truncates long error bodies", async () => {
    const longBody = "x".repeat(500);
    globalThis.fetch = (async () =>
      new Response(longBody, { status: 500 })) as typeof fetch;
    try {
      await fetchUserInfo("https://example.com", "token");
      throw new Error("Expected fetchUserInfo to throw");
    } catch (err: any) {
      expect(err.message.length).toBeLessThanOrEqual(300); // 256 body + prefix
      expect(err.message).toContain("(500)");
    }
  });

  test("strips control characters from error", async () => {
    globalThis.fetch = (async () =>
      new Response("error\x00\x01\x02message", {
        status: 400,
      })) as typeof fetch;
    await expect(
      fetchUserInfo("https://example.com", "token"),
    ).rejects.toThrow("Failed to fetch user info (400): errormessage");
  });

  test("returns UserInfo on success", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ sub: "user123", address: "0xABC" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof fetch;
    const info = await fetchUserInfo("https://example.com", "good-token");
    expect(info.sub).toBe("user123");
    expect(info.address).toBe("0xABC");
  });
});

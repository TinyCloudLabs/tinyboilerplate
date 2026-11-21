import { describe, expect, test } from "bun:test";
import { issueSessionToken, verifySessionToken } from "../auth.js";

const KEY = "test-signing-key";
const ADDRESS = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

describe("issueSessionToken", () => {
  test("lasts a day unless told otherwise", async () => {
    const { expiresIn, token } = await issueSessionToken(ADDRESS, KEY);
    expect(expiresIn).toBe(24 * 60 * 60);
    expect(await verifySessionToken(token, KEY)).toEqual({ address: ADDRESS.toLowerCase() });
  });

  test("ends no later than `notAfter`", async () => {
    const { expiresIn } = await issueSessionToken(ADDRESS, KEY, {
      notAfter: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    expect(Math.abs(expiresIn - 2 * 60 * 60)).toBeLessThanOrEqual(1);
  });

  test("never outlasts a day, whatever `notAfter` says", async () => {
    const { expiresIn } = await issueSessionToken(ADDRESS, KEY, {
      notAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(expiresIn).toBe(24 * 60 * 60);
  });

  test("refuses a `notAfter` that has passed", async () => {
    await expect(
      issueSessionToken(ADDRESS, KEY, { notAfter: new Date(Date.now() - 1000) }),
    ).rejects.toThrow("future");
  });
});

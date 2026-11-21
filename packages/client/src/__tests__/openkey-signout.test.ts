import { describe, expect, test } from "bun:test";
import { openKeySignOutNotice, signOutOpenKey } from "../openkey.js";

type Client = Parameters<typeof signOutOpenKey>[0];

function client(signOut: () => Promise<{ requestId: string; revoked: boolean }>) {
  const calls = { count: 0 };
  const value = {
    signOut: () => {
      calls.count++;
      return signOut();
    },
  } as unknown as NonNullable<Client>;
  return { calls, value };
}

describe("signOutOpenKey", () => {
  test("the tab that signed in calls OpenKey signOut on its own client", async () => {
    const current = client(async () => ({ requestId: "r", revoked: true }));
    const fallback = client(async () => ({ requestId: "r", revoked: true }));
    expect(await signOutOpenKey(current.value, () => fallback.value)).toBe(true);
    expect(current.calls.count).toBe(1);
    expect(fallback.calls.count).toBe(0);
  });

  test("a tab restored through the lease has no client in memory, so it builds one and calls signOut", async () => {
    const fallback = client(async () => ({ requestId: "r", revoked: true }));
    expect(await signOutOpenKey(null, () => fallback.value)).toBe(true);
    expect(fallback.calls.count).toBe(1);
  });

  test("only revoked === true counts as ended", async () => {
    const unconfirmed = client(async () => ({ requestId: "r", revoked: false }));
    expect(await signOutOpenKey(unconfirmed.value, () => unconfirmed.value)).toBe(false);
    const failing = client(async () => {
      throw new Error("OpenKey unreachable");
    });
    expect(await signOutOpenKey(failing.value, () => failing.value)).toBe(false);
  });

  test("gives up after the cap when OpenKey does not answer", async () => {
    const hung = client(() => new Promise(() => {}));
    const started = Date.now();
    expect(await signOutOpenKey(hung.value, () => hung.value, 50)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("openKeySignOutNotice", () => {
  test("a confirmed revocation shows no notice", () => {
    expect(openKeySignOutNotice(true)).toBeNull();
  });

  test("an unconfirmed one says renewal may still be on and where to stop it", () => {
    const notice = openKeySignOutNotice(false);
    expect(notice).toContain("renewal may still be on");
    expect(notice).toContain("Renewing permissions");
  });
});

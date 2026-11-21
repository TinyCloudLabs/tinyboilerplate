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
  test("a confirmed revocation says the access won't renew", () => {
    expect(openKeySignOutNotice(true, "App Starter")).toBe(
      "Signed out of App Starter in this browser. App Starter's access won't renew.",
    );
  });

  test("an unconfirmed one gives the standing text with the app's name", () => {
    expect(openKeySignOutNotice(false, "App Starter")).toBe(
      "You're signed out of App Starter in this browser, but OpenKey may still be renewing its access. To stop that, choose Stop renewal under Renewing permissions in OpenKey settings.",
    );
  });
});

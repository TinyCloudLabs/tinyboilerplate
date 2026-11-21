import { describe, expect, test } from "bun:test";
import { createSignOutGuard } from "../signout-guard.js";

// A sign-in written the way the app starter's is: capture, then check after every await.
function startSignIn(guard: ReturnType<typeof createSignOutGuard>, openkey: Promise<string>) {
  const saved: { session: string | null; receipt: string | null; state: string } = {
    session: null,
    receipt: null,
    state: "signing-in",
  };
  const cleared: string[] = [];
  const superseded = guard.capture(() => {
    saved.session = null;
    saved.receipt = null;
    cleared.push("session and receipt");
  });
  const done = (async () => {
    const address = await openkey;
    if (await superseded()) return false;
    saved.session = address;
    const lease = await Promise.resolve("receipt");
    if (await superseded()) return false;
    saved.receipt = lease;
    saved.state = "ready";
    return true;
  })();
  return { saved, cleared, done };
}

describe("a sign-out while a sign-in awaits OpenKey", () => {
  test("leaves no saved session, no receipt and a signed-out state", async () => {
    const guard = createSignOutGuard();
    let approve!: (address: string) => void;
    const signIn = startSignIn(guard, new Promise((resolve) => (approve = resolve)));
    signIn.saved.state = "signed-out";
    guard.signedOut();
    approve("0xabc");
    expect(await signIn.done).toBe(false);
    expect(signIn.saved).toEqual({ session: null, receipt: null, state: "signed-out" });
    expect(signIn.cleared).toEqual(["session and receipt"]);
  });

  test("is caught after a later await too, once the session was saved", async () => {
    const guard = createSignOutGuard();
    let approve!: (address: string) => void;
    const signIn = startSignIn(guard, new Promise((resolve) => (approve = resolve)));
    approve("0xabc");
    await Promise.resolve();
    await Promise.resolve();
    guard.signedOut();
    expect(await signIn.done).toBe(false);
    expect(signIn.saved.session).toBeNull();
    expect(signIn.saved.receipt).toBeNull();
  });

  test("a sign-in that started after the sign-out is not affected", async () => {
    const guard = createSignOutGuard();
    guard.signedOut();
    const signIn = startSignIn(guard, Promise.resolve("0xabc"));
    expect(await signIn.done).toBe(true);
    expect(signIn.saved).toEqual({ session: "0xabc", receipt: "receipt", state: "ready" });
    expect(signIn.cleared).toEqual([]);
  });
});

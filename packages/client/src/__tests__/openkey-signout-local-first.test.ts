import { describe, expect, test } from "bun:test";
import { OPENKEY_SIGN_OUT_TIMEOUT_MS, signOutLocalFirst } from "../openkey.js";

type Current = Parameters<typeof signOutLocalFirst>[0]["current"];

const answersAfter = (ms: number, revoked: boolean) =>
  ({
    signOut: () =>
      new Promise((resolve) => setTimeout(() => resolve({ requestId: "r", revoked }), ms)),
  }) as unknown as NonNullable<Current>;

describe("signOutLocalFirst", () => {
  test("clears the app before OpenKey has answered, so the signed-out screen never waits", async () => {
    const order: string[] = [];
    const pending = signOutLocalFirst({
      clearLocal: () => {
        order.push("cleared");
      },
      showSignedOut: () => order.push("screen"),
      current: {
        signOut: () => {
          order.push("asked");
          return new Promise(() => {});
        },
      } as unknown as NonNullable<Current>,
      fallback: () => {
        throw new Error("unused");
      },
      timeoutMs: 50,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(["cleared", "screen", "asked"]);
    expect(await pending).toBe(false);
  });

  test("waits for a person to press Sign out: an answer inside the cap counts, one past it warns", async () => {
    const fallback = () => answersAfter(0, true);
    expect(
      await signOutLocalFirst({
        clearLocal: () => {},
        showSignedOut: () => {},
        current: answersAfter(150, true),
        fallback,
        timeoutMs: 300,
      }),
    ).toBe(true);
    expect(
      await signOutLocalFirst({
        clearLocal: () => {},
        showSignedOut: () => {},
        current: answersAfter(400, true),
        fallback,
        timeoutMs: 300,
      }),
    ).toBe(false);
  });

  test("shows the signed-out screen before asking OpenKey even when the local sign-out throws", async () => {
    const order: string[] = [];
    const revoked = await signOutLocalFirst({
      clearLocal: () => {
        throw new Error("storage unavailable");
      },
      showSignedOut: () => order.push("screen"),
      current: {
        signOut: async () => {
          order.push("asked");
          return { requestId: "r", revoked: true };
        },
      } as unknown as NonNullable<Current>,
      fallback: () => {
        throw new Error("unused");
      },
    });
    expect(order).toEqual(["screen", "asked"]);
    expect(revoked).toBe(true);
  });

  test("the cap is 120 seconds", () => {
    expect(OPENKEY_SIGN_OUT_TIMEOUT_MS).toBe(120_000);
  });
});

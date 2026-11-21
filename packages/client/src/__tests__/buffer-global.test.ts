import { expect, test } from "bun:test";

test("importing the client's TinyCloud module installs Buffer where the bundle has none", async () => {
  const original = globalThis.Buffer;
  // @ts-expect-error simulate a browser bundle
  delete globalThis.Buffer;
  try {
    expect(typeof globalThis.Buffer).toBe("undefined");
    await import(`../buffer-global.js?fresh=${Date.now()}`);
    expect(typeof globalThis.Buffer).toBe("function");
    expect(globalThis.Buffer.from("hello").toString("base64")).toBe("aGVsbG8=");
  } finally {
    globalThis.Buffer = original;
  }
});

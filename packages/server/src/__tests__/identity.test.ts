import { describe, test, expect, mock, beforeEach } from "bun:test";
import { withSessionRefresh, isSessionError } from "../identity.js";

function createMockNode() {
  return {
    signIn: mock(() => Promise.resolve()),
  };
}

describe("withSessionRefresh", () => {
  let mockNode: ReturnType<typeof createMockNode>;

  beforeEach(() => {
    mockNode = createMockNode();
  });

  test("returns the function result on success", async () => {
    const result = await withSessionRefresh(mockNode as any, () =>
      Promise.resolve("ok"),
    );
    expect(result).toBe("ok");
    expect(mockNode.signIn).not.toHaveBeenCalled();
  });

  test("retries once after session-related error", async () => {
    let callCount = 0;
    const fn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("session expired"));
      }
      return Promise.resolve("recovered");
    });

    const result = await withSessionRefresh(mockNode as any, fn);

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mockNode.signIn).toHaveBeenCalledTimes(1);
  });

  test("re-throws non-session errors without retrying", async () => {
    const fn = mock(() => Promise.reject(new Error("network timeout")));

    await expect(withSessionRefresh(mockNode as any, fn)).rejects.toThrow(
      "network timeout",
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockNode.signIn).not.toHaveBeenCalled();
  });

  test("calls node.signIn() before retry", async () => {
    const callOrder: string[] = [];

    mockNode.signIn = mock(() => {
      callOrder.push("signIn");
      return Promise.resolve();
    });

    let callCount = 0;
    const fn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("401 Unauthorized"));
      }
      callOrder.push("fn-retry");
      return Promise.resolve("done");
    });

    await withSessionRefresh(mockNode as any, fn);

    expect(callOrder).toEqual(["signIn", "fn-retry"]);
  });

  describe("session error detection", () => {
    const sessionErrorMessages = [
      "session expired",
      "invalid session token",
      "Session has expired. Please sign in again.",
      "Authentication required. Please sign in first.",
      "Not signed in. Call signIn() first.",
      "401 Unauthorized",
      "401 Not Authorized",
    ];

    for (const msg of sessionErrorMessages) {
      test(`retries on error: "${msg}"`, async () => {
        let callCount = 0;
        const fn = mock(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error(msg));
          }
          return Promise.resolve("ok");
        });

        const result = await withSessionRefresh(mockNode as any, fn);
        expect(result).toBe("ok");
        expect(mockNode.signIn).toHaveBeenCalledTimes(1);
      });
    }
  });

  describe("structured error detection", () => {
    test("retries on error with AUTH_EXPIRED code", async () => {
      let callCount = 0;
      const fn = mock(() => {
        callCount++;
        if (callCount === 1) {
          const error: any = new Error("Session has expired");
          error.code = "AUTH_EXPIRED";
          return Promise.reject(error);
        }
        return Promise.resolve("ok");
      });

      const result = await withSessionRefresh(mockNode as any, fn);
      expect(result).toBe("ok");
      expect(mockNode.signIn).toHaveBeenCalledTimes(1);
    });

    test("retries on error with AUTH_REQUIRED code", async () => {
      let callCount = 0;
      const fn = mock(() => {
        callCount++;
        if (callCount === 1) {
          const error: any = new Error("Authentication required");
          error.code = "AUTH_REQUIRED";
          return Promise.reject(error);
        }
        return Promise.resolve("ok");
      });

      const result = await withSessionRefresh(mockNode as any, fn);
      expect(result).toBe("ok");
      expect(mockNode.signIn).toHaveBeenCalledTimes(1);
    });

    test("retries on error with status 401", async () => {
      let callCount = 0;
      const fn = mock(() => {
        callCount++;
        if (callCount === 1) {
          const error: any = new Error("Request failed");
          error.status = 401;
          return Promise.reject(error);
        }
        return Promise.resolve("ok");
      });

      const result = await withSessionRefresh(mockNode as any, fn);
      expect(result).toBe("ok");
      expect(mockNode.signIn).toHaveBeenCalledTimes(1);
    });

    test("retries on error with statusCode 401", async () => {
      let callCount = 0;
      const fn = mock(() => {
        callCount++;
        if (callCount === 1) {
          const error: any = new Error("Request failed");
          error.statusCode = 401;
          return Promise.reject(error);
        }
        return Promise.resolve("ok");
      });

      const result = await withSessionRefresh(mockNode as any, fn);
      expect(result).toBe("ok");
      expect(mockNode.signIn).toHaveBeenCalledTimes(1);
    });

    test("does not retry on non-auth error codes", async () => {
      const error: any = new Error("Something failed");
      error.code = "NETWORK_ERROR";
      const fn = mock(() => Promise.reject(error));

      await expect(withSessionRefresh(mockNode as any, fn)).rejects.toThrow(
        "Something failed",
      );
      expect(mockNode.signIn).not.toHaveBeenCalled();
    });

    test("does not retry on non-401 status", async () => {
      const error: any = new Error("Not found");
      error.status = 404;
      const fn = mock(() => Promise.reject(error));

      await expect(withSessionRefresh(mockNode as any, fn)).rejects.toThrow(
        "Not found",
      );
      expect(mockNode.signIn).not.toHaveBeenCalled();
    });
  });

  test("does not retry on generic errors", async () => {
    const nonSessionErrors = [
      "not found",
      "internal server error",
      "rate limited",
      "ECONNREFUSED",
      "delegation expired",
      "certificate expired",
      "expired credentials",
      "unauthorized request",
    ];

    for (const msg of nonSessionErrors) {
      const node = createMockNode();
      const fn = mock(() => Promise.reject(new Error(msg)));

      await expect(withSessionRefresh(node as any, fn)).rejects.toThrow(msg);
      expect(node.signIn).not.toHaveBeenCalled();
    }
  });
});

describe("isSessionError", () => {
  test("returns false for plain non-session errors", () => {
    expect(isSessionError(new Error("network timeout"))).toBe(false);
    expect(isSessionError(new Error("delegation expired"))).toBe(false);
    expect(isSessionError(new Error("certificate expired"))).toBe(false);
  });

  test("returns true for session-related messages", () => {
    expect(isSessionError(new Error("session expired"))).toBe(true);
    expect(
      isSessionError(new Error("Not signed in. Call signIn() first.")),
    ).toBe(true);
  });

  test("returns true for structured AUTH_EXPIRED code", () => {
    const error: any = new Error("something");
    error.code = "AUTH_EXPIRED";
    expect(isSessionError(error)).toBe(true);
  });

  test("returns true for status 401", () => {
    const error: any = new Error("something");
    error.status = 401;
    expect(isSessionError(error)).toBe(true);
  });
});

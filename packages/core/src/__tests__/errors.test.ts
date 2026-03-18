import { describe, it, expect } from "bun:test";
import {
  TinyBoilerplateError,
  AuthenticationError,
  TokenError,
  NetworkError,
  PopupBlockedError,
  DelegationError,
} from "../index.js";

describe("Structured Errors", () => {
  describe("TinyBoilerplateError", () => {
    it("extends Error", () => {
      const err = new TinyBoilerplateError("test_code", "test message");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TinyBoilerplateError);
    });

    it("has correct code and message", () => {
      const err = new TinyBoilerplateError("test_code", "test message");
      expect(err.code).toBe("test_code");
      expect(err.message).toBe("test message");
      expect(err.name).toBe("TinyBoilerplateError");
    });

    it("supports cause chaining", () => {
      const cause = new Error("root cause");
      const err = new TinyBoilerplateError("test_code", "wrapped", { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe("AuthenticationError", () => {
    it("extends TinyBoilerplateError and Error", () => {
      const err = new AuthenticationError("auth failed");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TinyBoilerplateError);
      expect(err).toBeInstanceOf(AuthenticationError);
    });

    it("has code 'authentication_error'", () => {
      const err = new AuthenticationError("auth failed");
      expect(err.code).toBe("authentication_error");
      expect(err.name).toBe("AuthenticationError");
    });

    it("supports optional statusCode", () => {
      const err = new AuthenticationError("unauthorized", { statusCode: 401 });
      expect(err.statusCode).toBe(401);
    });

    it("supports cause chaining with statusCode", () => {
      const cause = new Error("token expired");
      const err = new AuthenticationError("auth failed", { cause, statusCode: 401 });
      expect(err.cause).toBe(cause);
      expect(err.statusCode).toBe(401);
    });

    it("statusCode is undefined when not provided", () => {
      const err = new AuthenticationError("auth failed");
      expect(err.statusCode).toBeUndefined();
    });
  });

  describe("TokenError", () => {
    it("extends TinyBoilerplateError and Error", () => {
      const err = new TokenError("no refresh token");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TinyBoilerplateError);
      expect(err).toBeInstanceOf(TokenError);
    });

    it("has code 'token_error'", () => {
      const err = new TokenError("refresh failed");
      expect(err.code).toBe("token_error");
      expect(err.name).toBe("TokenError");
    });

    it("supports cause chaining", () => {
      const cause = new Error("network timeout");
      const err = new TokenError("refresh failed", { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe("NetworkError", () => {
    it("extends TinyBoilerplateError and Error", () => {
      const err = new NetworkError("request failed");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TinyBoilerplateError);
      expect(err).toBeInstanceOf(NetworkError);
    });

    it("has code 'network_error'", () => {
      const err = new NetworkError("request failed");
      expect(err.code).toBe("network_error");
      expect(err.name).toBe("NetworkError");
    });

    it("supports optional statusCode", () => {
      const err = new NetworkError("server error", { statusCode: 500 });
      expect(err.statusCode).toBe(500);
    });

    it("supports cause chaining with statusCode", () => {
      const cause = { error: "HTTP 500" };
      const err = new NetworkError("API error", { cause, statusCode: 500 });
      expect(err.cause).toBe(cause);
      expect(err.statusCode).toBe(500);
    });

    it("statusCode is undefined when not provided", () => {
      const err = new NetworkError("timeout");
      expect(err.statusCode).toBeUndefined();
    });
  });

  describe("PopupBlockedError", () => {
    it("extends TinyBoilerplateError and Error", () => {
      const err = new PopupBlockedError("popup blocked");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TinyBoilerplateError);
      expect(err).toBeInstanceOf(PopupBlockedError);
    });

    it("has code 'popup_blocked'", () => {
      const err = new PopupBlockedError("popup blocked");
      expect(err.code).toBe("popup_blocked");
      expect(err.name).toBe("PopupBlockedError");
    });

    it("supports cause chaining", () => {
      const cause = new Error("window.open returned null");
      const err = new PopupBlockedError("popup blocked", { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe("DelegationError", () => {
    it("extends TinyBoilerplateError and Error", () => {
      const err = new DelegationError("delegation failed");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TinyBoilerplateError);
      expect(err).toBeInstanceOf(DelegationError);
    });

    it("has code 'delegation_error'", () => {
      const err = new DelegationError("delegation failed");
      expect(err.code).toBe("delegation_error");
      expect(err.name).toBe("DelegationError");
    });

    it("supports cause chaining", () => {
      const cause = new Error("expired parent");
      const err = new DelegationError("delegation failed", { cause });
      expect(err.cause).toBe(cause);
    });
  });

  describe("catch patterns", () => {
    it("catch TinyBoilerplateError catches all typed errors", () => {
      const errors = [
        new AuthenticationError("a"),
        new TokenError("b"),
        new NetworkError("c"),
        new PopupBlockedError("d"),
        new DelegationError("e"),
      ];

      for (const err of errors) {
        expect(err).toBeInstanceOf(TinyBoilerplateError);
      }
    });

    it("catch Error catches all typed errors (backward compatible)", () => {
      const errors = [
        new TinyBoilerplateError("base", "f"),
        new AuthenticationError("g"),
        new TokenError("h"),
        new NetworkError("i"),
        new PopupBlockedError("j"),
        new DelegationError("k"),
      ];

      for (const err of errors) {
        expect(err).toBeInstanceOf(Error);
      }
    });

    it("each error type is distinguishable by instanceof", () => {
      const authErr = new AuthenticationError("a");
      const tokenErr = new TokenError("b");

      expect(authErr).toBeInstanceOf(AuthenticationError);
      expect(authErr).not.toBeInstanceOf(TokenError);

      expect(tokenErr).toBeInstanceOf(TokenError);
      expect(tokenErr).not.toBeInstanceOf(AuthenticationError);
    });

    it("each error type is distinguishable by code", () => {
      const errors: TinyBoilerplateError[] = [
        new AuthenticationError("a"),
        new TokenError("b"),
        new NetworkError("c"),
        new PopupBlockedError("d"),
        new DelegationError("e"),
      ];

      const codes = errors.map((e) => e.code);
      expect(codes).toEqual([
        "authentication_error",
        "token_error",
        "network_error",
        "popup_blocked",
        "delegation_error",
      ]);
    });
  });
});

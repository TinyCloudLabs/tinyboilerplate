import { mock } from "bun:test";

// Mock external dependencies that aren't installed in the test environment.
// These mocks must be registered before any source module tries to import them.

// Lightweight stand-ins for the error hierarchy so source modules that
// import them (e.g., auth.ts) can reference the classes at runtime.
class TinyBoilerplateError extends Error {
  code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TinyBoilerplateError";
    this.code = code;
  }
}

class AuthenticationError extends TinyBoilerplateError {
  statusCode?: number;
  constructor(code: string, message: string, options?: ErrorOptions & { statusCode?: number }) {
    super(code, message, options);
    this.name = "AuthenticationError";
    this.statusCode = (options as any)?.statusCode;
  }
}

class NetworkError extends TinyBoilerplateError {
  statusCode?: number;
  constructor(code: string, message: string, options?: ErrorOptions & { statusCode?: number }) {
    super(code, message, options);
    this.name = "NetworkError";
    this.statusCode = (options as any)?.statusCode;
  }
}

class TokenError extends TinyBoilerplateError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "TokenError";
  }
}

class PopupBlockedError extends TinyBoilerplateError {
  constructor(message: string, options?: ErrorOptions) {
    super("POPUP_BLOCKED", message, options);
    this.name = "PopupBlockedError";
  }
}

class DelegationError extends TinyBoilerplateError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "DelegationError";
  }
}

mock.module("@tinyboilerplate/core", () => ({
  DELEGATION_CACHE_TTL_MS: 50 * 60 * 1000,
  DEFAULT_DELEGATION_CACHE_MAX_SIZE: 1000,
  consoleLogger: {
    debug() {},
    info() {},
    warn() {},
    error() {},
  },
  noopLogger: {
    debug() {},
    info() {},
    warn() {},
    error() {},
  },
  toISODateString(date = new Date()) {
    return date.toISOString();
  },
  TinyBoilerplateError,
  AuthenticationError,
  NetworkError,
  TokenError,
  PopupBlockedError,
  DelegationError,
}));

mock.module("@tinycloud/node-sdk", () => ({
  TinyCloudNode: class {},
}));

import { mock } from "bun:test";

// Mock external dependencies that aren't installed in the test environment.
// These mocks must be registered before any source module tries to import them.

// Provide real implementations for @tinyboilerplate/core.
// We can't use dynamic import here because mock.module must be synchronous,
// so we replicate the actual exports that server source files depend on.

class TinyBoilerplateError extends Error {
  public readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TinyBoilerplateError";
    this.code = code;
  }
}

class AuthenticationError extends TinyBoilerplateError {
  public readonly statusCode?: number;
  constructor(message: string, options?: ErrorOptions & { statusCode?: number }) {
    super("authentication_error", message, options);
    this.name = "AuthenticationError";
    this.statusCode = options?.statusCode;
  }
}

class TokenError extends TinyBoilerplateError {
  constructor(message: string, options?: ErrorOptions) {
    super("token_error", message, options);
    this.name = "TokenError";
  }
}

class NetworkError extends TinyBoilerplateError {
  public readonly statusCode?: number;
  constructor(message: string, options?: ErrorOptions & { statusCode?: number }) {
    super("network_error", message, options);
    this.name = "NetworkError";
    this.statusCode = options?.statusCode;
  }
}

class PopupBlockedError extends TinyBoilerplateError {
  constructor(message: string, options?: ErrorOptions) {
    super("popup_blocked", message, options);
    this.name = "PopupBlockedError";
  }
}

class DelegationError extends TinyBoilerplateError {
  constructor(message: string, options?: ErrorOptions) {
    super("delegation_error", message, options);
    this.name = "DelegationError";
  }
}

const consoleLogger = {
  debug(message: string, ...args: unknown[]) {
    console.debug(message, ...args);
  },
  info(message: string, ...args: unknown[]) {
    console.info(message, ...args);
  },
  warn(message: string, ...args: unknown[]) {
    console.warn(message, ...args);
  },
  error(message: string, ...args: unknown[]) {
    console.error(message, ...args);
  },
};

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function toISODateString(date: Date = new Date()): string {
  return date.toISOString();
}

mock.module("@tinyboilerplate/core", () => ({
  // Error types
  TinyBoilerplateError,
  AuthenticationError,
  TokenError,
  NetworkError,
  PopupBlockedError,
  DelegationError,
  // Logger
  consoleLogger,
  noopLogger,
  // Utilities
  toISODateString,
  // Constants
  DELEGATION_CACHE_TTL_MS: 50 * 60 * 1000,
  DEFAULT_DELEGATION_CACHE_MAX_SIZE: 1000,
  DEFAULT_DELEGATION_ACTIONS: [
    "tinycloud.kv/get",
    "tinycloud.kv/put",
    "tinycloud.kv/del",
    "tinycloud.kv/list",
  ],
  DEFAULT_DELEGATION_PATH: "",
  DEFAULT_DELEGATION_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
  DEFAULT_FETCH_TIMEOUT_MS: 30_000,
}));

mock.module("@tinycloud/node-sdk", () => ({
  TinyCloudNode: class {},
}));

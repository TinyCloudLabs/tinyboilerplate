// ── Base Error ──────────────────────────────────────────────────────

/**
 * Base error class for all TinyBoilerplate errors.
 * Every typed error extends this, so `instanceof TinyBoilerplateError`
 * catches any SDK-originated error while `instanceof Error` still works.
 */
export class TinyBoilerplateError extends Error {
  public readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TinyBoilerplateError";
    this.code = code;
  }
}

// ── Authentication ──────────────────────────────────────────────────

/**
 * Authentication or authorization failure (missing token, invalid session, etc.).
 */
export class AuthenticationError extends TinyBoilerplateError {
  public readonly statusCode?: number;

  constructor(message: string, options?: ErrorOptions & { statusCode?: number }) {
    super("authentication_error", message, options);
    this.name = "AuthenticationError";
    this.statusCode = options?.statusCode;
  }
}

// ── Token ───────────────────────────────────────────────────────────

/**
 * Token-related failures: missing refresh token, refresh endpoint errors, etc.
 */
export class TokenError extends TinyBoilerplateError {
  constructor(message: string, options?: ErrorOptions) {
    super("token_error", message, options);
    this.name = "TokenError";
  }
}

// ── Network ─────────────────────────────────────────────────────────

/**
 * HTTP / network-level failure (non-2xx status, timeout, DNS, etc.).
 */
export class NetworkError extends TinyBoilerplateError {
  public readonly statusCode?: number;

  constructor(message: string, options?: ErrorOptions & { statusCode?: number }) {
    super("network_error", message, options);
    this.name = "NetworkError";
    this.statusCode = options?.statusCode;
  }
}

// ── Popup Blocked ───────────────────────────────────────────────────

/**
 * Browser blocked the sign-in popup (common with passkey / OAuth flows).
 */
export class PopupBlockedError extends TinyBoilerplateError {
  constructor(message: string, options?: ErrorOptions) {
    super("popup_blocked", message, options);
    this.name = "PopupBlockedError";
  }
}

// ── Delegation ──────────────────────────────────────────────────────

/**
 * Delegation creation, verification, or revocation failure.
 */
export class DelegationError extends TinyBoilerplateError {
  constructor(message: string, options?: ErrorOptions) {
    super("delegation_error", message, options);
    this.name = "DelegationError";
  }
}

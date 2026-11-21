import { randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";

// ── Types ────────────────────────────────────────────────────────────

export interface NonceEntry {
  nonce: string;
  address: string;
  createdAt: number;
}

export interface NonceStore {
  generate(address: string): string;
  validate(address: string, nonce: string): boolean;
}

export interface SessionTokenPayload {
  address: string;
}

// ── Nonce Store ─────────────────────────────────────────────────────

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create an in-memory nonce store for SIWE authentication.
 *
 * Nonces are:
 * - Cryptographically random (32 bytes hex)
 * - Bound to a specific address
 * - Single-use (deleted after validation)
 * - Short-lived (5 minute TTL)
 */
export function createNonceStore(): NonceStore {
  const store = new Map<string, NonceEntry>();

  // Periodic cleanup of expired nonces
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.createdAt > NONCE_TTL_MS) {
        store.delete(key);
      }
    }
  }, 60_000);
  cleanupInterval.unref();

  return {
    generate(address: string): string {
      const normalizedAddress = address.toLowerCase();
      const nonce = randomBytes(32).toString("hex");
      const key = `${normalizedAddress}:${nonce}`;

      store.set(key, {
        nonce,
        address: normalizedAddress,
        createdAt: Date.now(),
      });

      return nonce;
    },

    validate(address: string, nonce: string): boolean {
      const normalizedAddress = address.toLowerCase();
      const key = `${normalizedAddress}:${nonce}`;
      const entry = store.get(key);

      if (!entry) return false;

      // Delete immediately — single use
      store.delete(key);

      // Check TTL
      if (Date.now() - entry.createdAt > NONCE_TTL_MS) {
        return false;
      }

      return true;
    },
  };
}

// ── SIWE Verification ───────────────────────────────────────────────

/**
 * Verify a SIWE message and signature using the `siwe` package.
 * Returns the recovered address and nonce from the message.
 */
export async function verifySIWE(
  message: string,
  signature: string,
): Promise<{ address: string; nonce: string; domain: string; uri: string }> {
  // Dynamic import to avoid requiring siwe at module load time
  const { SiweMessage } = await import("siwe");

  const siweMessage = new SiweMessage(message);
  const result = await siweMessage.verify({ signature });

  if (!result.success) {
    throw new Error("SIWE signature verification failed");
  }

  return {
    address: result.data.address,
    nonce: result.data.nonce,
    domain: result.data.domain,
    uri: result.data.uri,
  };
}

/**
 * Is a SIWE grant meant for this app? Its domain must be the frontend's host, and its URI either the session key the
 * grant delegates to or the frontend's own origin. Without this, a grant the owner gave another app would sign this
 * app's backend in as the owner.
 */
export function isExpectedSiweOrigin(domain: string, uri: string, frontendUrl: string): boolean {
  let frontend: URL;
  try {
    frontend = new URL(frontendUrl);
  } catch {
    return false;
  }
  return domain === frontend.host && (uri === frontend.origin || /^did:key:z/.test(uri));
}

/** What a SIWE message and signature prove, checked without the nonce store. */
export interface VerifiedSiweSession {
  address: string;
  chainId: number;
  uri: string;
  domain: string;
  expirationTime?: string;
}

/**
 * Verify a SIWE signature locally. A SIWE past its expiry is checked at its last valid instant, so a caller can tell a
 * genuine session that has ended (a renewal lease may carry it on) from a forged signature.
 */
export async function verifySiweSession(
  message: string,
  signature: string,
): Promise<VerifiedSiweSession> {
  const { SiweMessage } = await import("siwe");

  const siweMessage = new SiweMessage(message);
  const expiry = Date.parse(siweMessage.expirationTime ?? "");
  const time =
    Number.isFinite(expiry) && expiry <= Date.now()
      ? new Date(expiry - 1).toISOString()
      : undefined;
  const result = await siweMessage.verify({ signature, ...(time ? { time } : {}) });
  if (!result.success) {
    throw new Error("SIWE signature verification failed");
  }
  return {
    address: result.data.address,
    chainId: result.data.chainId,
    uri: result.data.uri,
    domain: result.data.domain,
    expirationTime: result.data.expirationTime,
  };
}

// ── Session Token ───────────────────────────────────────────────────

/**
 * Issue a session JWT signed with HS256.
 * Subject is the wallet address.
 */
export async function issueSessionToken(
  address: string,
  privateKey: string,
  options?: { notAfter?: Date },
): Promise<{ token: string; expiresIn: number }> {
  const secret = new TextEncoder().encode(privateKey);
  const now = Math.floor(Date.now() / 1000);
  let exp = now + 24 * 60 * 60; // 24 hours
  if (options?.notAfter) {
    const notAfter = options.notAfter.getTime();
    if (!Number.isFinite(notAfter)) throw new Error("Invalid session expiration");
    exp = Math.min(exp, Math.floor(notAfter / 1000));
  }
  const expiresIn = exp - now;
  if (expiresIn <= 0) throw new Error("Session expiration must be in the future");

  const token = await new SignJWT({ address: address.toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(address.toLowerCase())
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret);

  return { token, expiresIn };
}

/**
 * Verify a session JWT issued by this backend.
 * Returns the wallet address from the token.
 */
export async function verifySessionToken(
  token: string,
  privateKey: string,
): Promise<{ address: string }> {
  const secret = new TextEncoder().encode(privateKey);

  const { payload } = await jwtVerify(token, secret, {
    algorithms: ["HS256"],
  });

  if (!payload.sub) {
    throw new Error("Session token missing 'sub' claim");
  }

  return { address: payload.sub };
}

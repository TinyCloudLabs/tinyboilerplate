// ── Re-export everything ─────────────────────────────────────────────

export {
  createBackendIdentity,
  backendIdentityManifest,
  withSessionRefresh,
  type BackendIdentityConfig,
  type BackendIdentity,
} from "./identity.js";

export { DelegationStore, type DelegationMetadata } from "./delegation-store.js";

export { DelegationCache } from "./delegation-cache.js";

export type { DelegatedAccess } from "@tinycloud/node-sdk";

export {
  createNonceStore,
  verifySIWE,
  verifySiweSession,
  issueSessionToken,
  verifySessionToken,
  type NonceStore,
  type NonceEntry,
  type SessionTokenPayload,
  type VerifiedSiweSession,
} from "./auth.js";

export {
  renewalHolderProofMessage,
  renewalVerifyConfigFromEnv,
  verifyRenewal,
  type RenewalVerifyConfig,
  type RenewalVerifyDependencies,
  type RenewalVerifyInput,
  type RenewalVerifyResult,
} from "./renewal-verify.js";

export { createCsrfMiddleware, type CsrfConfig } from "./csrf.js";

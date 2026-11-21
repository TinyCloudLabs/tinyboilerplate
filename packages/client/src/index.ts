// ── Re-export everything ─────────────────────────────────────────────

export {
  connectWallet,
  openKeyRenewalClient,
  openKeySignOutNotice,
  signOutOpenKey,
  type ConnectWalletConfig,
  type ConnectWalletResult,
  type OpenKeyRenewalAsk,
  type OpenKeyRenewalOutcome,
} from "./openkey.js";

export {
  SIGN_IN_RENEWAL_ASK,
  admitSignInRenewal,
  keptLeaseEnd,
  renewalRestoreFor,
  renewalRestoreVerdict,
  settleFailedRestore,
  verifiedRenewalLease,
  type RenewalRestore,
} from "./renewal.js";

export {
  createTinyCloudWeb,
  createAndSignIn,
  restoreTinyCloudWebSession,
  type RestoreTinyCloudWebSessionResult,
  type TinyCloudWebConfig,
} from "./tinycloud.js";

export {
  loadAppManifest,
  backendManifestFromServerInfo,
  composeManifestWithBackend,
  composeManifestWithDelegatees,
  resolveManifestPermissions,
  resolveManifestDelegationPermissions,
  resolveManifestPermissionPath,
} from "./manifest.js";

export {
  loadPersistedSession,
  clearPersistedSession,
  clearRenewalReceipt,
  loadRenewalReceipt,
  saveRenewalReceipt,
  type PersistedTinyCloudSession,
} from "./session-persistence.js";

export {
  createDelegation,
  createManifestDelegation,
  sendDelegation,
  checkDelegationStatus,
  revokeDelegation,
} from "./delegation.js";

export {
  requestNonce,
  renewalHolderProofMessage,
  renewalVerifyProof,
  verifyRenewedSession,
  verifySession,
  type RenewalVerifyProof,
  type VerifyRenewedSessionBody,
  type VerifyRenewedSessionResponse,
  type VerifyResponse,
} from "./auth.js";

export { DEFAULT_REQUEST_HEADER_NAME, DEFAULT_REQUEST_HEADER_VALUE } from "./request-headers.js";

export { SessionStore, type StoredSession } from "./tokens.js";

export { ApiRequestError, createApiClient, type ApiClient, type ApiClientConfig } from "./api.js";

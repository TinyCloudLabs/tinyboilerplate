// ── Re-export everything ─────────────────────────────────────────────

export {
  openKeySignIn,
  type OpenKeyConfig,
  type SignInResult,
} from "./openkey.js";

export {
  createAndSignIn,
  type TinyCloudWebConfig,
} from "./tinycloud.js";

export {
  createDelegation,
  sendDelegation,
  checkDelegationStatus,
  revokeDelegation,
  type DelegationOptions,
} from "./delegation.js";

export {
  TokenStore,
  type StoredTokens,
  type TokenRefreshConfig,
  type TokenStoreConfig,
} from "./tokens.js";

export {
  createLocalStoragePersistence,
  createSessionStoragePersistence,
  type TokenPersistence,
} from "./persistence.js";

export {
  createApiClient,
  type ApiClient,
  type ApiClientConfig,
} from "./api.js";

export {
  signOut,
  type SignOutConfig,
} from "./sign-out.js";

export {
  type AuthEvent,
  type AuthEventListener,
  type Unsubscribe,
} from "./auth-events.js";

export {
  DelegationMonitor,
  type DelegationMonitorOptions,
  type ExpiringCallback,
  type ExpiredCallback,
  type MonitorUnsubscribe,
} from "./delegation-monitor.js";

// Re-export core types used across packages
export {
  type ISODateString,
  toISODateString,
  type Logger,
  consoleLogger,
  noopLogger,
} from "@tinyboilerplate/core";

import { TinyCloudWeb, BrowserSessionStorage } from "@tinycloud/web-sdk";
import type {
  ClientSession,
  ComposedManifestRequest,
  Config as TinyCloudWebSdkConfig,
  Manifest,
  SessionRestoreResult,
  SiweConfig,
} from "@tinycloud/web-sdk";
import { composeManifestRequest } from "@tinycloud/sdk-core";
import type { EIP1193Provider } from "@openkey/sdk";

// ── Configuration ────────────────────────────────────────────────────

export interface TinyCloudWebConfig {
  tinycloudHosts?: string[];
  tinycloudRegistryUrl?: string | null;
  /** Host hint for owners absent from both registries. Default https://node.tinycloud.xyz; null disables onboarding. */
  newUserHost?: string | null;
  autoCreateSpace?: boolean;
  siweConfig?: SiweConfig;
  /**
   * Manifest driving the SIWE recap at sign-in. If `capabilityRequest`
   * is present, it takes precedence and is signed directly.
   */
  manifest?: Manifest;
  /** Pre-composed manifest request that may include app and delegate manifests. */
  capabilityRequest?: ComposedManifestRequest;
  /** Include implicit account registry permissions when composing `manifest`. Default true in the SDK. */
  includeAccountRegistryPermissions?: boolean;
  /** SIWE nonce override. If set, `siweConfig.nonce` still wins inside the SDK. */
  nonce?: string;
  /** Lifetime of the signed-in session in milliseconds. Defaults to the SDK default. */
  sessionExpirationMs?: number;
}

/**
 * OpenKey client for sign-in: `{ client: openkey }` with the `openkey` returned by
 * `connectWallet`. TinyCloud sign-in is OpenKey's versioned approval, where the
 * owner reviews the permissions the session will hold.
 */
export type OpenKeySignInConfig = NonNullable<TinyCloudWebSdkConfig["openkey"]>;

export interface RestoreTinyCloudWebSessionResult {
  tcw: TinyCloudWeb | null;
  status: SessionRestoreResult["status"];
  session?: ClientSession;
  error?: Error;
}

// ── TinyCloudWeb Instance ────────────────────────────────────────────

/**
 * Create a TinyCloudWeb instance with BrowserSessionStorage for session persistence.
 */
export function createTinyCloudWeb(
  web3Provider: EIP1193Provider,
  config?: TinyCloudWebConfig & { openkey?: OpenKeySignInConfig },
): TinyCloudWeb {
  const manifest = config?.manifest ?? config?.capabilityRequest?.manifests;
  const tcwConfig: TinyCloudWebSdkConfig = {
    provider: web3Provider,
    openkey: config?.openkey,
    tinycloudHosts: config?.tinycloudHosts,
    tinycloudRegistryUrl: config?.tinycloudRegistryUrl,
    newUserHost: config?.newUserHost,
    autoCreateSpace: config?.autoCreateSpace ?? true,
    sessionStorage: new BrowserSessionStorage(),
    nonce: config?.nonce,
    siweConfig: config?.siweConfig,
    manifest,
    capabilityRequest: config?.capabilityRequest,
    includeAccountRegistryPermissions: config?.includeAccountRegistryPermissions,
    sessionExpirationMs: config?.sessionExpirationMs,
  };

  return new TinyCloudWeb(tcwConfig);
}

/**
 * Create a TinyCloudWeb instance and sign in through OpenKey's approval.
 *
 * Accepts an optional `nonce` to pass through to the SDK's SIWE message
 * construction, optional manifest/capability request inputs that drive
 * the session's granted capabilities, and an optional `sessionExpirationMs`.
 * The SDK's `signIn()` returns a `ClientSession` containing the signed SIWE
 * message and signature.
 */
export async function createAndSignIn(
  web3Provider: EIP1193Provider,
  config: TinyCloudWebConfig & { openkey: OpenKeySignInConfig; address?: string },
): Promise<{ tcw: TinyCloudWeb; session: ClientSession }> {
  const siweConfig = config.nonce
    ? { ...config.siweConfig, nonce: config.nonce }
    : config.siweConfig;
  const tcw = createTinyCloudWeb(web3Provider, { ...config, siweConfig });
  if (config.nonce) {
    await tcw.clearPersistedSession(config.address);
  }
  // The nonce travels in the config above: the OpenKey path refuses per-call SIWE overrides.
  const session = await tcw.signIn();

  // The owner can untick permissions in OpenKey and the SDK accepts the narrower session.
  // The app cannot work without what it asked for, so refuse it and leave no session.
  const required = requestedResources(config);
  if (required.length > 0 && !tcw.hasPermissions(required)) {
    // Best effort: the refusal below is the result, whether or not cleanup succeeds.
    await tcw.signOut().catch(() => {});
    throw new Error(narrowedApprovalMessage(requestedManifests(config)));
  }
  return { tcw, session };
}

function requestedManifests(config: TinyCloudWebConfig): Manifest[] {
  const manifests = config.manifest ?? config.capabilityRequest?.manifests ?? [];
  return Array.isArray(manifests) ? manifests : [manifests];
}

/** The permissions the sign-in asked OpenKey to approve. */
function requestedResources(config: TinyCloudWebConfig) {
  if (config.capabilityRequest) return config.capabilityRequest.resources;
  const manifests = requestedManifests(config);
  if (manifests.length === 0) return [];
  return composeManifestRequest(manifests, {
    includeAccountRegistryPermissions: config.includeAccountRegistryPermissions,
  }).resources;
}

/**
 * Plain words for an owner who narrowed the approval: which permissions the app
 * needs (the manifest's own descriptions) and what to do. Draft copy, Monica words it.
 */
export function narrowedApprovalMessage(manifests: readonly Manifest[]): string {
  const name = manifests[0]?.name ?? "This app";
  const reasons = [
    ...new Set(
      manifests.flatMap((manifest) =>
        (manifest.permissions ?? []).flatMap((permission) =>
          permission.description ? [permission.description] : [],
        ),
      ),
    ),
  ];
  const needs =
    reasons.length > 0
      ? `${name} needs these permissions to work: ${reasons.join(" ")}`
      : `${name} needs every permission it asked for to work.`;
  return `${needs} Sign in again and keep all permissions.`;
}

/**
 * Restore a browser TinyCloudWeb session from BrowserSessionStorage without
 * connecting a wallet. The returned instance is session-only: it can use the
 * restored TinyCloud delegation for direct storage, but cannot create new
 * wallet-signed delegations until a provider is connected later.
 */
export async function restoreTinyCloudWebSession(
  address: string,
  config?: TinyCloudWebConfig,
): Promise<RestoreTinyCloudWebSessionResult> {
  const manifest = config?.manifest ?? config?.capabilityRequest?.manifests;
  const tcwConfig: TinyCloudWebSdkConfig = {
    tinycloudHosts: config?.tinycloudHosts,
    tinycloudRegistryUrl: config?.tinycloudRegistryUrl,
    newUserHost: config?.newUserHost,
    autoCreateSpace: config?.autoCreateSpace ?? false,
    sessionStorage: new BrowserSessionStorage(),
    nonce: config?.nonce,
    siweConfig: config?.siweConfig,
    manifest,
    capabilityRequest: config?.capabilityRequest,
    includeAccountRegistryPermissions: config?.includeAccountRegistryPermissions,
  };

  const tcw = new TinyCloudWeb(tcwConfig);

  try {
    const result = await tcw.restoreSession(address);
    if (result.status === "restored") {
      return { tcw, status: result.status, session: result.session };
    }

    tcw.cleanup();
    return { tcw: null, status: result.status, error: result.error };
  } catch (err) {
    tcw.cleanup();
    return {
      tcw: null,
      status: "restore-failed",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

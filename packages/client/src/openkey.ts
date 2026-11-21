import OpenKey, { OpenKeyProvider, type EIP1193Provider } from "@openkey/sdk";
import type { Config as TinyCloudWebSdkConfig } from "@tinycloud/web-sdk";

// ── Configuration ────────────────────────────────────────────────────

export interface ConnectWalletConfig {
  host?: string;
  appName?: string;
}

export interface ConnectWalletResult {
  address: string;
  keyId: string;
  /**
   * Pass this as `openkey: { client: openkey }` to `createAndSignIn`. TinyCloud
   * sign-in goes through OpenKey's versioned `authorizeTinyCloud` approval, not
   * through `web3Provider`.
   */
  openkey: OpenKey;
  /** Gives TinyCloudWeb the account address. It is not used to sign the session. */
  web3Provider: EIP1193Provider;
}

// ── Sign-in with renewal ─────────────────────────────────────────────

/**
 * The renewal ask for OpenKey's sign-in window. OpenKey offers it only beside `expiryChangeable: true`, and only to
 * an `@openkey/sdk` that forwards it (0.13.0-beta.0 and later); an older one ignores it and the sign-in stays finite.
 */
export interface OpenKeyRenewalAsk {
  version: 1;
  leaseLifetimeSeconds: number;
  purpose?: "standing" | "task";
}

/** What the sign-in result says about renewal. An @openkey/sdk without sign-in renewal leaves both out. */
export interface OpenKeyRenewalOutcome {
  renewalChoice?: unknown;
  /** The lease receipt OpenKey signed, unverified and not yet admitted at the node. */
  renewal?: unknown;
}

type OpenKeySignInClient = NonNullable<TinyCloudWebSdkConfig["openkey"]>["client"];

/**
 * The OpenKey client the SDK's sign-in calls, adding the renewal ask to OpenKey's request and handing what comes
 * back about renewal to `onOutcome` before the SDK builds the session from the signed result.
 */
export function openKeyRenewalClient(
  openkey: OpenKey,
  renewal: OpenKeyRenewalAsk,
  onOutcome: (outcome: OpenKeyRenewalOutcome) => void,
): OpenKeySignInClient {
  return {
    authorizeTinyCloud: async (request, opts) => {
      const result = await openkey.authorizeTinyCloud(
        { ...request, renewal } as Parameters<OpenKey["authorizeTinyCloud"]>[0],
        opts,
      );
      const { renewalChoice, renewal: receipt } = result as OpenKeyRenewalOutcome;
      onOutcome({ renewalChoice, renewal: receipt });
      return result;
    },
  };
}

/**
 * What to tell the owner after a sign-out: that renewal stopped (`revoked === true`, the only outcome that counts as
 * ended) or that OpenKey did not confirm it and where to stop it. Draft copy, the copy owner words it.
 */
export function openKeySignOutNotice(revoked: boolean, appName: string): string {
  return revoked
    ? `Signed out of ${appName} in this browser. ${appName}'s access won't renew.`
    : `You're signed out of ${appName} in this browser, but OpenKey may still be renewing its access. To stop that, choose Stop renewal under Renewing permissions in OpenKey settings.`;
}

/**
 * How long the app waits for OpenKey to confirm a sign-out. OpenKey's sign-out window waits for the person to press
 * Sign out, so the wait is long; the app has signed out locally by then (see `signOutLocalFirst`).
 */
export const OPENKEY_SIGN_OUT_TIMEOUT_MS = 120_000;

/**
 * Ends the OpenKey session, which also stops the renewal lease that sign-in recorded for it. Prefers the client that
 * signed in; a restored session has none, so `fallback` builds one and OpenKey's own window signs the browser session
 * out. Never throws. Resolves true only when OpenKey confirmed the revocation: every other outcome (cancelled,
 * unreachable, no token found) leaves a live OpenKey session that the owner can stop in OpenKey's settings.
 */
export async function signOutOpenKey(
  current: Pick<OpenKey, "signOut"> | null,
  fallback: () => Pick<OpenKey, "signOut">,
  timeoutMs = OPENKEY_SIGN_OUT_TIMEOUT_MS,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("OpenKey sign-out timed out")), timeoutMs);
  });
  try {
    const acknowledgement = await Promise.race([
      Promise.resolve().then(() => (current ?? fallback()).signOut()),
      deadline,
    ]);
    return acknowledgement.revoked === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Signs out locally, then asks OpenKey. `clearLocal` ends the app's own session and receipt; `showSignedOut` swaps the
 * screen and always runs, right after it and even when it throws, before OpenKey is asked. Neither waits for OpenKey,
 * so the signed-out screen shows at once; the answer only decides the notice (`openKeySignOutNotice`).
 */
export async function signOutLocalFirst(options: {
  clearLocal: () => void | Promise<void>;
  showSignedOut: () => void;
  current: Pick<OpenKey, "signOut"> | null;
  fallback: () => Pick<OpenKey, "signOut">;
  timeoutMs?: number;
}): Promise<boolean> {
  try {
    await options.clearLocal();
  } catch (error) {
    console.error("[sign-out] local sign-out failed:", error);
  } finally {
    options.showSignedOut();
  }
  return signOutOpenKey(options.current, options.fallback, options.timeoutMs);
}

// ── Connect Wallet ──────────────────────────────────────────────────

/**
 * Connect wallet via OpenKey passkey authentication.
 *
 * Returns the connected OpenKey client, the wallet address and an EIP-1193
 * provider for TinyCloudWeb. Sign-in itself is the OpenKey approval that
 * `createAndSignIn` starts from the `openkey` client.
 */
export async function connectWallet(config?: ConnectWalletConfig): Promise<ConnectWalletResult> {
  const openkey = new OpenKey({
    host: config?.host ?? "https://openkey.so",
    appName: config?.appName ?? "TinyCloud App",
  });

  // Passkey authentication via iframe — the user authenticates and the client can then ask for TinyCloud approval.
  console.log("[openkey] Calling openkey.connect()...");
  const authResult = await openkey.connect();
  console.log("[openkey] connect() done. Address:", authResult.address);

  return {
    address: authResult.address,
    keyId: authResult.keyId,
    openkey,
    web3Provider: new OpenKeyProvider(openkey, authResult),
  };
}

import OpenKey from "@openkey/sdk";
import { providers } from "ethers";

// ── Configuration ────────────────────────────────────────────────────

export interface OpenKeyConfig {
  host?: string;
  appName?: string;
}

export interface SignInResult {
  address: string;
  keyId: string;
  openkey: OpenKey;
  web3Provider: providers.Web3Provider;
}

// ── EIP-1193 Provider ────────────────────────────────────────────────

/**
 * EIP-1193 compatible provider that routes signing to OpenKey.
 * TinyCloudWeb treats this like any browser wallet.
 */
class OpenKeyEIP1193Provider {
  constructor(
    private openkey: OpenKey,
    private address: string,
    private keyId: string,
  ) {}

  async request({ method, params }: { method: string; params?: any[] }): Promise<any> {
    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return [this.address];
      case "eth_chainId":
        return "0x1";
      case "personal_sign": {
        if (!params?.[0]) {
          throw new Error("personal_sign requires a message parameter");
        }
        const hexMessage = params[0];
        const message = hexToString(hexMessage);
        const result = await this.openkey.signMessage({
          message,
          keyId: this.keyId,
        });
        return result.signature;
      }
      case "eth_getBalance":
        return "0x0";
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }
}

function hexToString(hex: string): string {
  const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
  const matches = cleaned.match(/.{1,2}/g) ?? [];
  const bytes = new Uint8Array(matches.map((b) => parseInt(b, 16)));
  return new TextDecoder().decode(bytes);
}

// ── Sign In ──────────────────────────────────────────────────────────

/**
 * Detect popup-blocked errors across browsers.
 * Popup blockers cause errors with varying messages — match common patterns.
 */
function isPopupBlockedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /popup.*(blocked|closed)|blocked.*popup|user.*cancel|window.*closed/i.test(message);
}

/**
 * Single-step OpenKey sign-in: connect → get signing provider.
 *
 * Opens one popup for passkey authentication. Returns an ethers
 * Web3Provider wired to OpenKey for signing, ready for TinyCloudWeb.
 */
export async function openKeySignIn(config?: OpenKeyConfig): Promise<SignInResult> {
  if (!config?.host) {
    console.warn(
      "[tinyboilerplate] No OpenKey host specified — defaulting to production (https://openkey.so). " +
      "Set `host` explicitly to silence this warning.",
    );
  }

  const openkey = new OpenKey({
    host: config?.host ?? "https://openkey.so",
    appName: config?.appName ?? "TinyBoilerplate",
  });

  // Single popup — user authenticates with passkey, selects key
  let authResult;
  try {
    authResult = await openkey.connect();
  } catch (err) {
    if (isPopupBlockedError(err)) {
      throw new Error(
        "Sign-in popup was blocked by the browser. Please allow popups for this site and try again.",
        { cause: err },
      );
    }
    throw err;
  }

  // Create EIP-1193 provider that routes signing through OpenKey
  const eip1193 = new OpenKeyEIP1193Provider(
    openkey,
    authResult.address,
    authResult.keyId,
  );

  // Wrap in ethers Web3Provider for TinyCloudWeb compatibility
  const web3Provider = new providers.Web3Provider(eip1193);

  return {
    address: authResult.address,
    keyId: authResult.keyId,
    openkey,
    web3Provider,
  };
}

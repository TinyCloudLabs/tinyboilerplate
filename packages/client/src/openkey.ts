import OpenKey, { OpenKeyProvider, type EIP1193Provider } from "@openkey/sdk";

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

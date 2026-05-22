import { chromium, type BrowserContext, type Page } from "playwright";

import {
  extractStoredSession,
  fetchBackendIdentity,
  fetchDelegationStatus,
  fetchProbe,
  resolveRealAuthCommandEnv,
  resolveRealAuthConfig,
  type DelegationResponse,
  type PlaywrightStorageState,
  type RealAuthConfig,
  type StoredSession,
} from "./real-auth-support.ts";

const repoRoot = new URL("..", import.meta.url).pathname;
const env = resolveRealAuthCommandEnv({ cwd: repoRoot, env: process.env });
const config = resolveRealAuthConfig({ cwd: repoRoot, env });

console.log("Starting headed Playwright for TinyCloud real auth.");
console.log(`Frontend: ${config.frontendUrl}`);
console.log(`Backend:  ${config.backendUrl}`);
console.log(
  `Browser: ${config.browserChannel ?? "installed Chrome if available, otherwise bundled Chromium"}`,
);
if (config.userDataDir) console.log(`Browser profile: ${config.userDataDir}`);
console.log("");
console.log("Complete the real OpenKey/TinyCloud sign-in and backend delegation in the browser.");
console.log("Playwright will continue in this same browser session after delegation is active.");
console.log(
  "Use HTTP localhost or trusted HTTPS. WebAuthn is not supported on sites with TLS certificate errors.",
);

const launched = await launchManualContext(config);

try {
  const { context } = launched;
  const page = await context.newPage();
  await openFrontendPage(page, config.frontendUrl);
  await page.bringToFront();

  const { delegation, session } = await waitForActiveDelegation(context, config);
  const identity = await fetchBackendIdentity(config.backendUrl);

  await page.getByLabel("Value").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByLabel("Value").fill(config.probeValue);
  await page.getByRole("button", { name: "Save probe" }).click();
  await page.getByRole("heading", { name: "Probe value stored" }).waitFor({ timeout: 30_000 });

  const probe = await waitForProbeValue(session.token, config.backendUrl, config.probeValue);

  console.log("");
  console.log("Verified delegated probe with delegated backend access.");
  console.log(`App id: ${identity.appId}`);
  console.log(`Backend DID: ${identity.backendDid}`);
  console.log(`Policy hash: ${identity.policyHash}`);
  console.log(`Delegation expires at: ${delegation.expiresAt}`);
  console.log(`Probe updated at: ${probe.updatedAt}`);
} finally {
  await launched.close();
}

async function launchManualContext(config: RealAuthConfig): Promise<{
  close: () => Promise<void>;
  context: BrowserContext;
}> {
  const preferredChannel = config.browserChannel ?? "chrome";

  const launchWithChannel = async (channel: string | undefined) => {
    if (config.userDataDir) {
      const context = await chromium.launchPersistentContext(config.userDataDir, {
        channel,
        headless: false,
      });
      return { context, close: () => context.close() };
    }

    const browser = await chromium.launch({ channel, headless: false });
    const context = await browser.newContext();
    return { context, close: () => browser.close() };
  };

  try {
    return await launchWithChannel(preferredChannel);
  } catch (error) {
    if (config.browserChannel) throw error;
    console.warn(
      `Could not launch installed Chrome (${errorMessage(error)}). Falling back to bundled Chromium.`,
    );
    console.warn(
      "If the passkey prompt asks for a security key, install Chrome and rerun with REAL_AUTH_BROWSER=chrome REAL_AUTH_USER_DATA_DIR=.auth/chrome-profile.",
    );
    return launchWithChannel(undefined);
  }
}

async function openFrontendPage(page: Page, frontendUrl: string): Promise<void> {
  try {
    await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  } catch (error) {
    const message = errorMessage(error);
    if (
      message.includes("ERR_CERT") ||
      message.includes("SSL") ||
      message.includes("certificate")
    ) {
      throw new Error(
        `Could not open ${frontendUrl} because the browser rejected its TLS certificate. Use HTTP localhost or trusted HTTPS. WebAuthn is not supported on sites with TLS certificate errors.`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function waitForActiveDelegation(
  context: BrowserContext,
  config: RealAuthConfig,
): Promise<{ delegation: DelegationResponse; session: StoredSession }> {
  const deadline = Date.now() + config.timeoutMs;
  let lastStatus = "waiting for browser session";
  let lastLogged = "";
  let lastError: unknown;

  while (Date.now() < deadline) {
    const browserState = (await context.storageState()) as PlaywrightStorageState;
    const session = extractStoredSession(browserState, config.sessionStorageKey);
    if (!session) {
      lastError = undefined;
      lastStatus = "waiting for app-starter backend session token in browser storage";
    } else if (session.expiresAt <= Date.now() + 30_000) {
      lastError = undefined;
      lastStatus = "app-starter backend session token is expired or about to expire";
    } else {
      try {
        const delegation = await fetchDelegationStatus(config.backendUrl, session.token);
        lastError = undefined;
        lastStatus = `delegation status: ${delegation.status}`;
        if (delegation.status === "active" && delegation.expiresAt) {
          return { delegation, session };
        }
      } catch (error) {
        lastError = error;
        lastStatus = errorMessage(error);
      }
    }

    if (lastStatus !== lastLogged) {
      console.log(lastStatus);
      lastLogged = lastStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for active delegation: ${lastStatus}`, {
    cause: lastError,
  });
}

async function waitForProbeValue(
  token: string,
  backendUrl: string,
  expected: string,
): Promise<{ value: string; updatedAt: string }> {
  const deadline = Date.now() + 30_000;
  let lastValue = "<empty>";

  while (Date.now() < deadline) {
    const { probe } = await fetchProbe(backendUrl, token);
    if (probe?.value === expected) return probe;
    lastValue = probe?.value ?? "<empty>";
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Probe verification failed. Last observed value: ${lastValue}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

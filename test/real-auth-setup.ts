import { chromium, type BrowserContext } from "playwright";

import {
  buildMetadata,
  extractStoredSession,
  fetchBackendIdentity,
  fetchDelegationStatus,
  resolveRealAuthConfig,
  writePrivateJsonFile,
  type DelegationResponse,
  type PlaywrightStorageState,
  type RealAuthConfig,
  type StoredSession,
} from "./real-auth-fixture.ts";

const repoRoot = new URL("..", import.meta.url).pathname;
const config = resolveRealAuthConfig({ cwd: repoRoot, env: process.env });

console.log("Starting headed Chromium for TinyCloud real auth setup.");
console.log(`Frontend: ${config.frontendUrl}`);
console.log(`Backend:  ${config.backendUrl}`);
console.log(`Fixture: ${config.fixturePath}`);
console.log(
  `Browser: ${config.browserChannel ?? "installed Chrome if available, otherwise bundled Chromium"}`,
);
if (config.userDataDir) console.log(`Browser profile: ${config.userDataDir}`);
console.log("");
console.log("Complete the real OpenKey/TinyCloud sign-in and backend delegation in the browser.");
console.log("The fixture will be saved only after /api/delegations/status reports active.");

const launched = await launchSetupContext(config);

try {
  const { context } = launched;
  const page = await context.newPage();
  await page.goto(config.frontendUrl, { waitUntil: "domcontentloaded" });
  await page.bringToFront();

  const result = await waitForActiveDelegation(context, config);
  const backendIdentity = await fetchBackendIdentity(config.backendUrl);
  const storageState = await context.storageState();
  const metadata = buildMetadata({
    backendIdentity,
    config,
    delegation: result.delegation,
    session: result.session,
  });

  writePrivateJsonFile(config.fixturePath, storageState);
  writePrivateJsonFile(config.metadataPath, metadata);

  console.log("");
  console.log("Saved TinyCloud real auth fixture.");
  console.log(`Storage state: ${config.fixturePath}`);
  console.log(`Metadata:      ${config.metadataPath}`);
  console.log(`Delegation expires at: ${metadata.expiresAt}`);
} finally {
  await launched.close();
}

async function launchSetupContext(config: RealAuthConfig): Promise<{
  close: () => Promise<void>;
  context: BrowserContext;
}> {
  const ignoreHTTPSErrors = process.env.REAL_AUTH_IGNORE_HTTPS_ERRORS === "1";
  const preferredChannel = config.browserChannel ?? "chrome";

  const launchWithChannel = async (channel: string | undefined) => {
    if (config.userDataDir) {
      const context = await chromium.launchPersistentContext(config.userDataDir, {
        channel,
        headless: false,
        ignoreHTTPSErrors,
      });
      return { context, close: () => context.close() };
    }

    const browser = await chromium.launch({ channel, headless: false });
    const context = await browser.newContext({ ignoreHTTPSErrors });
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
      "If the passkey prompt asks for a security key, rerun with REAL_AUTH_BROWSER=chrome after installing Chrome.",
    );
    return launchWithChannel(undefined);
  }
}

async function waitForActiveDelegation(
  context: BrowserContext,
  config: RealAuthConfig,
): Promise<{ delegation: DelegationResponse; session: StoredSession }> {
  const deadline = Date.now() + config.timeoutMs;
  let lastStatus = "waiting for browser session";
  let lastLogged = "";

  while (Date.now() < deadline) {
    const storageState = (await context.storageState()) as PlaywrightStorageState;
    const session = extractStoredSession(storageState, config.sessionStorageKey);
    if (!session) {
      lastStatus = "waiting for backend session token in browser storage";
    } else if (session.expiresAt <= Date.now() + 30_000) {
      lastStatus = "backend session token is expired or about to expire";
    } else {
      try {
        const delegation = await fetchDelegationStatus(config.backendUrl, session.token);
        lastStatus = `delegation status: ${delegation.status}`;
        if (delegation.status === "active" && delegation.expiresAt) {
          return { delegation, session };
        }
      } catch (error) {
        lastStatus = error instanceof Error ? error.message : String(error);
      }
    }

    if (lastStatus !== lastLogged) {
      console.log(lastStatus);
      lastLogged = lastStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for active delegation: ${lastStatus}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

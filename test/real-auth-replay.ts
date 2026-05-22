import { existsSync } from "node:fs";
import { chromium } from "playwright";

import {
  extractStoredSession,
  fetchBackendIdentity,
  fetchDelegationStatus,
  fetchProbe,
  readJsonFile,
  resolveRealAuthConfig,
  validateFixtureForReplay,
  type PlaywrightStorageState,
  type RealAuthMetadata,
} from "./real-auth-fixture.ts";

const repoRoot = new URL("..", import.meta.url).pathname;
const config = resolveRealAuthConfig({ cwd: repoRoot, env: process.env });

if (!existsSync(config.fixturePath)) {
  throw new Error(`Missing real auth storage state: ${config.fixturePath}`);
}
if (!existsSync(config.metadataPath)) {
  throw new Error(`Missing real auth metadata: ${config.metadataPath}`);
}

const storageState = readJsonFile<PlaywrightStorageState>(config.fixturePath);
const metadata = readJsonFile<RealAuthMetadata>(config.metadataPath);
validateFixtureForReplay(metadata, {
  backendUrl: config.backendUrl,
  frontendUrl: config.frontendUrl,
  now: Date.now(),
});

const session = extractStoredSession(storageState, config.sessionStorageKey);
if (!session) {
  throw new Error("Real auth fixture does not contain an app-starter backend session token.");
}
if (session.expiresAt <= Date.now() + 30_000) {
  throw new Error("Real auth fixture backend session is expired.");
}
const token = session.token;

const current = await fetchBackendIdentity(config.backendUrl);
validateFixtureForReplay(metadata, {
  backendUrl: config.backendUrl,
  current,
  frontendUrl: config.frontendUrl,
  now: Date.now(),
});
const delegation = await fetchDelegationStatus(config.backendUrl, token);
if (delegation.status !== "active" || !delegation.expiresAt) {
  throw new Error(`Real auth fixture replay refused delegation status "${delegation.status}".`);
}
validateFixtureForReplay(
  { ...metadata, expiresAt: delegation.expiresAt },
  {
    backendUrl: config.backendUrl,
    current,
    frontendUrl: config.frontendUrl,
    now: Date.now(),
  },
);

const browser = await chromium.launch({
  headless: process.env.REAL_AUTH_HEADED === "1" ? false : true,
});

try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: process.env.REAL_AUTH_IGNORE_HTTPS_ERRORS === "1",
    storageState: config.fixturePath,
  });
  const page = await context.newPage();
  await page.goto(config.frontendUrl, { waitUntil: "domcontentloaded" });

  const input = page.getByLabel("Value");
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await input.fill(config.probeValue);
  await page.getByRole("button", { name: "Save probe" }).click();
  await page.getByRole("heading", { name: "Probe value stored" }).waitFor({ timeout: 30_000 });

  const probe = await waitForProbeValue(token, config.backendUrl, config.probeValue);
  console.log("Real auth replay verified delegated backend access.");
  console.log(`Probe updated at: ${probe.updatedAt}`);
} finally {
  await browser.close();
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

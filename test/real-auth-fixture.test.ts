import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  extractSessionToken,
  resolveRealAuthCommandEnv,
  resolveRealAuthConfig,
  validateFixtureForReplay,
  type RealAuthMetadata,
} from "./real-auth-fixture.ts";

const repoRoot = new URL("..", import.meta.url).pathname;

describe("real auth harness package scripts", () => {
  test("exposes setup and replay commands from the test package", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "test/package.json"), "utf8"));

    expect(pkg.scripts["real-auth:setup"]).toBe("bun real-auth-command.ts setup");
    expect(pkg.scripts["real-auth"]).toBe("bun real-auth-command.ts replay");
  });
});

describe("real auth fixture config", () => {
  test("defaults to app-starter local ports and repo-local auth files", () => {
    const config = resolveRealAuthConfig({ cwd: repoRoot, env: {} });

    expect(config.frontendUrl).toBe("http://localhost:5175");
    expect(config.backendUrl).toBe("http://localhost:3003");
    expect(config.fixturePath).toBe(join(repoRoot, ".auth/tinycloud-real-auth.json"));
    expect(config.metadataPath).toBe(join(repoRoot, ".auth/tinycloud-real-auth.meta.json"));
    expect(config.browserChannel).toBeUndefined();
    expect(config.userDataDir).toBeUndefined();
  });

  test("lets callers override urls, fixture path, and setup browser", () => {
    const config = resolveRealAuthConfig({
      cwd: repoRoot,
      env: {
        FRONTEND_URL: "https://localhost:4443",
        BACKEND_URL: "http://localhost:3999",
        REAL_AUTH_BROWSER: "chrome",
        REAL_AUTH_STATE: "/tmp/state.json",
        REAL_AUTH_USER_DATA_DIR: ".auth/chrome-profile",
      },
    });

    expect(config.frontendUrl).toBe("https://localhost:4443");
    expect(config.backendUrl).toBe("http://localhost:3999");
    expect(config.fixturePath).toBe("/tmp/state.json");
    expect(config.metadataPath).toBe("/tmp/state.meta.json");
    expect(config.browserChannel).toBe("chrome");
    expect(config.userDataDir).toBe(join(repoRoot, ".auth/chrome-profile"));
  });

  test("auto-wires mkcert HTTPS defaults for command runs when local certs exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "tinyboilerplate-real-auth-"));
    try {
      await mkdir(join(root, "frontend"), { recursive: true });
      await writeFile(join(root, "frontend/localhost.pem"), "cert");
      await writeFile(join(root, "frontend/localhost-key.pem"), "key");
      await mkdir(join(root, "mkcert"), { recursive: true });
      await writeFile(join(root, "mkcert/rootCA.pem"), "ca");

      const env = resolveRealAuthCommandEnv({
        cwd: root,
        env: { REAL_AUTH_MKCERT_CAROOT: join(root, "mkcert") },
      });

      expect(env.FRONTEND_URL).toBe("https://localhost:5175");
      expect(env.BACKEND_URL).toBe("https://localhost:3003");
      expect(env.NODE_EXTRA_CA_CERTS).toBe(join(root, "mkcert/rootCA.pem"));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("does not replace explicit command URLs or CA settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "tinyboilerplate-real-auth-"));
    try {
      await mkdir(join(root, "frontend"), { recursive: true });
      await writeFile(join(root, "frontend/localhost.pem"), "cert");
      await writeFile(join(root, "frontend/localhost-key.pem"), "key");

      const env = resolveRealAuthCommandEnv({
        cwd: root,
        env: {
          BACKEND_URL: "http://localhost:3999",
          FRONTEND_URL: "http://localhost:4999",
          NODE_EXTRA_CA_CERTS: "/tmp/custom-ca.pem",
        },
      });

      expect(env.FRONTEND_URL).toBe("http://localhost:4999");
      expect(env.BACKEND_URL).toBe("http://localhost:3999");
      expect(env.NODE_EXTRA_CA_CERTS).toBe("/tmp/custom-ca.pem");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("real auth fixture validation", () => {
  const metadata: RealAuthMetadata = {
    appId: "xyz.tinycloud.app-starter",
    backendDid: "did:key:z6Mkharness",
    backendUrl: "http://localhost:3003",
    delegationStatus: "active",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    fixturePath: "/repo/.auth/tinycloud-real-auth.json",
    frontendUrl: "http://localhost:5175",
    policyHash: "sha256:fixture",
    savedAt: new Date().toISOString(),
    sessionExpiresAt: Date.now() + 60_000,
  };

  test("accepts current active metadata for the same frontend and backend", () => {
    expect(() =>
      validateFixtureForReplay(metadata, {
        backendUrl: metadata.backendUrl,
        frontendUrl: metadata.frontendUrl,
        now: Date.now(),
      }),
    ).not.toThrow();
  });

  test("rejects expired, stale, and mismatched metadata", () => {
    expect(() =>
      validateFixtureForReplay(
        { ...metadata, expiresAt: new Date(Date.now() - 1).toISOString() },
        { backendUrl: metadata.backendUrl, frontendUrl: metadata.frontendUrl, now: Date.now() },
      ),
    ).toThrow(/expired/i);

    expect(() =>
      validateFixtureForReplay(
        { ...metadata, delegationStatus: "stale" },
        { backendUrl: metadata.backendUrl, frontendUrl: metadata.frontendUrl, now: Date.now() },
      ),
    ).toThrow(/active/i);

    expect(() =>
      validateFixtureForReplay(metadata, {
        backendUrl: "http://127.0.0.1:4000",
        frontendUrl: metadata.frontendUrl,
        now: Date.now(),
      }),
    ).toThrow(/backend/i);
  });
});

describe("storage state session extraction", () => {
  test("extracts the app-starter bearer token from Playwright storage state", () => {
    const token = extractSessionToken({
      cookies: [],
      origins: [
        {
          origin: "http://localhost:5175",
          localStorage: [
            {
              name: "tinycloud-app-starter:session",
              value: JSON.stringify({
                address: "0x123",
                expiresAt: Date.now() + 60_000,
                token: "signed-session",
              }),
            },
          ],
        },
      ],
    });

    expect(token).toBe("signed-session");
  });
});

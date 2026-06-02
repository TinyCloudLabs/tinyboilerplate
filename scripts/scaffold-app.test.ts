import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const repoRoot = new URL("..", import.meta.url).pathname;
const scriptPath = join(repoRoot, "scripts/scaffold-app.ts");
const generatedArtifactNames = new Set(["dist", ".turbo", "node_modules"]);

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("scaffold-app CLI", () => {
  test("prints help for --help and -h", async () => {
    for (const flag of ["--help", "-h"]) {
      const result = await runScaffold([flag]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("--out <dir>");
      expect(result.stdout).toContain("--app-id <id>");
      expect(result.stdout).toContain("--app-name <name>");
      expect(result.stdout).toContain("--backend-prefix <prefix>");
      expect(result.stdout).toContain("--frontend-package <name>");
      expect(result.stdout).toContain("--backend-package <name>");
      expect(result.stdout).toContain("--frontend-port <port>");
      expect(result.stdout).toContain("--backend-port <port>");
      expect(result.stdout).toContain("--force");
      expect(result.stdout).toContain("slash- and backslash-free");
      expect(result.stdout).toContain("numeric port");
      expect(result.stdout).toContain("Example:");
    }
  });

  test("creates a standalone starter with shared packages and deterministic renames", async () => {
    const parent = await mkdtemp(join(tmpdir(), "tinyboilerplate-scaffold-"));
    createdRoots.push(parent);
    const out = join(parent, "scratch-app");

    const result = await runScaffold([
      "--out",
      out,
      "--app-id",
      "xyz.tinycloud.scratch",
      "--app-name",
      "Scratch TinyCloud App",
      "--backend-prefix",
      "xyz.tinycloud.scratch-backend",
      "--frontend-package",
      "@scratch/tinycloud-frontend",
      "--backend-package",
      "@scratch/tinycloud-backend",
      "--frontend-port",
      "5185",
      "--backend-port",
      "3013",
    ]);

    expect(result.exitCode).toBe(0);
    expectTree(out, [
      "frontend/package.json",
      "frontend/.env.example",
      "frontend/src/App.tsx",
      "backend/package.json",
      "backend/.env.example",
      "backend/openapi.yaml",
      "backend/src/manifest.ts",
      "packages/core/package.json",
      "packages/client/package.json",
      "packages/server/package.json",
      "manifest.json",
      "README.md",
      "package.json",
      "tsconfig.base.json",
      "turbo.json",
      "eslint.config.js",
      "test/package.json",
      ".gitignore",
    ]);

    expectMissing(out, [
      "frontend/node_modules",
      "frontend/dist",
      "frontend/.turbo",
      "backend/node_modules",
      "packages/core/dist",
      "packages/core/.turbo",
      "packages/core/tsconfig.tsbuildinfo",
      "packages/client/node_modules",
      "packages/server/dist",
      "test/app-shell-smoke.ts",
      "test/node_modules",
      "test/.auth",
    ]);

    const generatedPaths = await listGeneratedPaths(out);
    expect(generatedPaths).toEqual(
      expect.arrayContaining(["backend/.env.example", "frontend/.env.example"]),
    );
    expect(generatedPaths.filter(isGeneratedArtifactPath)).toEqual([]);
    await expectGeneratedTextOmits(out, ["APP_STARTER", "AppStarter", "appStarter"]);

    const rootPackage = await readJson(join(out, "package.json"));
    expect(rootPackage).toMatchObject({
      private: true,
      type: "module",
      packageManager: "bun@1.3.9",
      workspaces: ["packages/*", "frontend", "backend", "test"],
      scripts: {
        dev: "turbo run dev --filter=@scratch/tinycloud-frontend --filter=@scratch/tinycloud-backend",
        "build:packages":
          "turbo run build --filter=@tinyboilerplate/core --filter=@tinyboilerplate/client --filter=@tinyboilerplate/server",
        "build:backend": "bun run --cwd backend build",
        "build:frontend": "bun run --cwd frontend build",
        "test:backend": "bun run --cwd backend test",
        "test:packages":
          "bun run --cwd packages/core test && bun run --cwd packages/client test && bun run --cwd packages/server test",
        build: "bun run build:packages && bun run build:backend && bun run build:frontend",
        test: "bun run test:backend && bun run test:packages",
        "test:real-auth": "bun run --cwd test real-auth",
        lint: "eslint .",
        "lint:fix": "eslint . --fix",
        "generate-key": "bun run packages/server/scripts/generate-key.ts backend/.env",
        postinstall:
          "node packages/client/scripts/fix-web-wasm-init.mjs && node packages/server/scripts/fix-wasm-esm.mjs",
      },
    });
    expect(rootPackage.overrides).toMatchObject({
      "@tinycloud/web-sdk": "2.2.0-beta.12",
      "@tinycloud/node-sdk": "2.2.0-beta.12",
    });

    expect(await readJson(join(out, "frontend/package.json"))).toMatchObject({
      name: "@scratch/tinycloud-frontend",
      dependencies: {
        "@tinyboilerplate/client": "workspace:*",
        "@tinyboilerplate/core": "workspace:*",
      },
    });
    expect(await readJson(join(out, "backend/package.json"))).toMatchObject({
      name: "@scratch/tinycloud-backend",
      dependencies: {
        "@tinyboilerplate/core": "workspace:*",
        "@tinyboilerplate/server": "workspace:*",
      },
    });
    expect(await readJson(join(out, "frontend/tsconfig.json"))).toMatchObject({
      extends: "../tsconfig.base.json",
    });
    expect(await readJson(join(out, "backend/tsconfig.json"))).toMatchObject({
      extends: "../tsconfig.base.json",
    });
    expect(await readJson(join(out, "packages/core/tsconfig.json"))).toMatchObject({
      extends: "../../tsconfig.base.json",
    });
    expect(await readJson(join(out, "packages/server/tsconfig.json"))).toMatchObject({
      extends: "../../tsconfig.base.json",
    });
    for (const packageName of ["core", "client", "server"]) {
      expect(await readJson(join(out, "packages", packageName, "package.json"))).toMatchObject({
        exports: {
          ".": {
            bun: "./src/index.ts",
          },
        },
      });
    }

    expect(await readJson(join(out, "manifest.json"))).toMatchObject({
      app_id: "xyz.tinycloud.scratch",
      name: "Scratch TinyCloud App",
    });

    await expectFileContains(join(out, "backend/src/manifest.ts"), [
      'export const APP_ID = "xyz.tinycloud.scratch";',
      'const BACKEND_DELEGATION_NAME = "Scratch TinyCloud App Backend";',
      "Scratch TinyCloud App storage probe",
    ]);
    await expectFileContains(join(out, "backend/src/startup.ts"), [
      'export const SCRATCH_BACKEND_KV_PREFIX = "xyz.tinycloud.scratch-backend";',
      "scratchBackendIdentityConfig",
      "createScratchBackendIdentity",
    ]);
    await expectFileOmits(join(out, "backend/src/startup.ts"), [
      "APP_ID",
      "APP_STARTER",
      "appStarter",
    ]);
    await expectFileOmits(join(out, "backend/src/startup.ts"), ["APP_ID", "AppStarter"]);
    await expectFileOmits(join(out, "backend/src/manifest.ts"), ["AppStarter"]);
    await expectFileContains(join(out, "backend/src/index.ts"), [
      "createScratchBackendIdentity",
      'process.env.PORT ?? "3013"',
      '"https://localhost:5185"',
      '"http://localhost:5185"',
      "Scratch TinyCloud App backend ready",
    ]);
    await expectFileContains(join(out, "backend/.env.example"), [
      "PORT=3013",
      "https://localhost:5185",
      "http://localhost:5185",
    ]);
    await expectFileContains(join(out, "frontend/.env.example"), [
      "http://localhost:5185 -> http://localhost:3013",
      "https://localhost:5185 -> https://localhost:3013",
      "VITE_BACKEND_URL=https://localhost:3013",
    ]);
    await expectFileContains(join(out, "frontend/vite.config.ts"), ["port: 5185"]);
    await expectFileContains(join(out, "frontend/src/App.tsx"), [
      "localhost:3013",
      'const APP_NAME = "Scratch TinyCloud App";',
      'new SessionStore("xyz.tinycloud.scratch:session")',
      "appName: APP_NAME",
      '<h1>{"Scratch TinyCloud App"}</h1>',
    ]);
    await expectFileContains(join(out, "test/real-auth-support.ts"), [
      'export const DEFAULT_FRONTEND_URL = "http://localhost:5185";',
      'export const DEFAULT_BACKEND_URL = "http://localhost:3013";',
      'export const DEFAULT_SESSION_STORAGE_KEY = "xyz.tinycloud.scratch:session";',
    ]);
    await expectFileContains(join(out, "test/real-auth-support.test.ts"), [
      'expect(config.backendUrl).toBe("http://localhost:3013");',
      'expect(config.frontendUrl).toBe("http://localhost:5185");',
      'expect(env.FRONTEND_URL).toBe("https://localhost:5185");',
      'expect(env.BACKEND_URL).toBe("https://localhost:3013");',
      'name: "xyz.tinycloud.scratch:session"',
    ]);
    await expectFileContains(join(out, "test/real-auth-manual.ts"), [
      "Complete the real OpenKey/TinyCloud sign-in",
      "Verified delegated probe",
    ]);
    expect(existsSync(join(out, "test/real-auth-replay.ts"))).toBe(false);
    expect(existsSync(join(out, "test/real-auth-setup.ts"))).toBe(false);
    expect(existsSync(join(out, "test/real-auth-command.ts"))).toBe(false);
    await expectFileContains(join(out, "frontend/index.html"), [
      "<title>Scratch TinyCloud App</title>",
    ]);
    await expectFileContains(join(out, "backend/openapi.yaml"), [
      'title: "Scratch TinyCloud App API"',
      'description: "API contract for the Scratch TinyCloud App backend."',
    ]);
    await expectFileContains(join(out, "backend/src/__tests__/manifest.test.ts"), [
      'expect(manifest.name).toBe("Scratch TinyCloud App");',
      'expect(config.name).toBe("Scratch TinyCloud App Backend");',
    ]);
    await expectFileContains(join(out, "backend/src/__tests__/startup.test.ts"), [
      'expect(SCRATCH_BACKEND_KV_PREFIX).toBe("xyz.tinycloud.scratch-backend");',
      "scratchBackendIdentityConfig",
    ]);
    await expectFileContains(join(out, "backend/src/__tests__/openapi.test.ts"), [
      'describe("Scratch TinyCloud App OpenAPI spec"',
    ]);
    await expectFileContains(join(out, "README.md"), [
      "This app was generated with:",
      "bun run generate-key",
      "writes `BACKEND_PRIVATE_KEY` to `backend/.env`",
      "bun run test",
      "The root test command runs the backend tests and copied shared package tests.",
      "bun run test:real-auth",
      "This is not an auth bypass.",
      "REAL_AUTH_BROWSER=chrome REAL_AUTH_USER_DATA_DIR=.auth/chrome-profile",
      "says to insert a key",
      'NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"',
      "FRONTEND_URL=https://localhost:5185 BACKEND_URL=https://localhost:3013",
      "Playwright keeps using that same live browser session",
      "WebAuthn is not supported on sites with TLS certificate errors",
      "## Standalone App",
    ]);
    await expectFileOmits(join(out, "README.md"), [
      "test:real-auth:setup",
      "saved Playwright auth state",
      "REAL_AUTH_IGNORE_HTTPS_ERRORS",
    ]);
    await expectFileOmits(join(out, "README.md"), ["The default ids are"]);
    await expectFileOmits(join(out, "README.md"), ["bun test"]);
    await expectFileContains(join(out, ".gitignore"), [
      ".auth/",
      "test-results/",
      "playwright-report/",
      "blob-report/",
      ".playwright/",
    ]);

    const generateKey = await runBun(["run", "generate-key"], out);
    expect(
      generateKey.exitCode,
      `bun run generate-key failed\nstdout:\n${generateKey.stdout}\nstderr:\n${generateKey.stderr}`,
    ).toBe(0);
    expect(await readFile(join(out, "backend/.env"), "utf-8")).toMatch(
      /^BACKEND_PRIVATE_KEY=0x[0-9a-f]{64}\n$/,
    );
    expect(existsSync(join(out, ".env"))).toBe(false);
  });

  test("escapes quoted app names and preserves arbitrary slash-free backend prefixes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "tinyboilerplate-scaffold-"));
    createdRoots.push(parent);
    const out = join(parent, "quote-app");

    const result = await runScaffold([
      "--out",
      out,
      "--app-id",
      "xyz.tinycloud.quote-pilot",
      "--app-name",
      'Quote "Pilot"',
      "--backend-prefix",
      "ops.auditprefix.backend",
      "--frontend-package",
      "@quote/pilot-frontend",
      "--backend-package",
      "@quote/pilot-backend",
      "--frontend-port",
      "5186",
      "--backend-port",
      "3014",
    ]);

    expect(result.exitCode).toBe(0);

    await expectFileContains(join(out, "backend/src/manifest.ts"), [
      'const BACKEND_DELEGATION_NAME = "Quote \\"Pilot\\" Backend";',
      'description: "Read and write the Quote \\"Pilot\\" storage probe.",',
      'throw new Error("Quote \\"Pilot\\" manifest must use defaults: false");',
    ]);
    await expectFileContains(join(out, "backend/src/startup.ts"), [
      'export const QUOTE_PILOT_BACKEND_KV_PREFIX = "ops.auditprefix.backend";',
    ]);
    await expectFileContains(join(out, "backend/src/__tests__/startup.test.ts"), [
      'describe("quote \\"pilot\\" backend startup config"',
      'expect(QUOTE_PILOT_BACKEND_KV_PREFIX).toBe("ops.auditprefix.backend");',
      'expect(QUOTE_PILOT_BACKEND_KV_PREFIX).not.toContain("/");',
    ]);
    await expectFileOmits(join(out, "backend/src/__tests__/startup.test.ts"), [
      "`${APP_ID}-backend`",
      "xyz.tinycloud.quote-pilot-backend",
    ]);
    await expectFileContains(join(out, "backend/src/__tests__/manifest.test.ts"), [
      'expect(manifest.name).toBe("Quote \\"Pilot\\"");',
      'expect(config.name).toBe("Quote \\"Pilot\\" Backend");',
    ]);
    await expectFileContains(join(out, "backend/src/__tests__/openapi.test.ts"), [
      'describe("Quote \\"Pilot\\" OpenAPI spec"',
    ]);
    await expectFileContains(join(out, "frontend/index.html"), [
      "<title>Quote &quot;Pilot&quot;</title>",
    ]);
    await expectFileContains(join(out, "frontend/src/App.tsx"), ['<h1>{"Quote \\"Pilot\\""}</h1>']);
    await expectFileContains(join(out, "frontend/src/App.tsx"), [
      'const APP_NAME = "Quote \\"Pilot\\"";',
      "appName: APP_NAME",
    ]);
    await expectFileContains(join(out, "backend/openapi.yaml"), [
      'title: "Quote \\"Pilot\\" API"',
      'description: "API contract for the Quote \\"Pilot\\" backend."',
    ]);
    await expectFileOmits(join(out, "README.md"), [
      "canonical app-starter source inside `tinyboilerplate`",
      "Raw template copy is useful for internal maintenance",
      "The scaffold copy/replacement pass should exclude generated artifacts",
    ]);
    await expectFileOmits(join(out, "backend/src/startup.ts"), ["AppStarter"]);
    await expectFileOmits(join(out, "backend/src/manifest.ts"), ["AppStarter"]);
  });

  test("derives package names when package flags are omitted", async () => {
    const parent = await mkdtemp(join(tmpdir(), "tinyboilerplate-scaffold-"));
    createdRoots.push(parent);
    const out = join(parent, "quote-pilot");

    const result = await runScaffold([
      "--out",
      out,
      "--app-id",
      "xyz.tinycloud.quote-pilot",
      "--app-name",
      'Quote "Pilot" & Co.',
      "--backend-prefix",
      "ops.auditprefix.backend",
      "--frontend-port",
      "6191",
      "--backend-port",
      "6192",
    ]);

    expect(result.exitCode).toBe(0);

    expect(await readJson(join(out, "package.json"))).toMatchObject({
      scripts: {
        dev: "turbo run dev --filter=xyz-tinycloud-quote-pilot-frontend --filter=xyz-tinycloud-quote-pilot-backend",
      },
    });
    expect(await readJson(join(out, "frontend/package.json"))).toMatchObject({
      name: "xyz-tinycloud-quote-pilot-frontend",
    });
    expect(await readJson(join(out, "backend/package.json"))).toMatchObject({
      name: "xyz-tinycloud-quote-pilot-backend",
    });
    await expectFileContains(join(out, "backend/src/startup.ts"), [
      'export const QUOTE_PILOT_BACKEND_KV_PREFIX = "ops.auditprefix.backend";',
    ]);
    await expectFileContains(join(out, "frontend/index.html"), [
      "<title>Quote &quot;Pilot&quot; &amp; Co.</title>",
    ]);
  });

  test("derives valid TypeScript identifiers for numeric-leading app ids", async () => {
    const parent = await mkdtemp(join(tmpdir(), "tinyboilerplate-scaffold-"));
    createdRoots.push(parent);
    const out = join(parent, "numeric-app");

    const result = await runScaffold([
      "--out",
      out,
      "--app-id",
      "xyz.tinycloud.123-app",
      "--app-name",
      "Numeric App",
      "--backend-prefix",
      "ops.numeric.backend",
      "--frontend-package",
      "@numeric/frontend",
      "--backend-package",
      "@numeric/backend",
      "--frontend-port",
      "6291",
      "--backend-port",
      "6292",
    ]);

    expect(result.exitCode).toBe(0);

    await expectFileContains(join(out, "backend/src/manifest.ts"), [
      "interface App123AppManifest",
      "function validateApp123AppManifest",
    ]);
    await expectFileContains(join(out, "backend/src/startup.ts"), [
      'export const APP_123_APP_BACKEND_KV_PREFIX = "ops.numeric.backend";',
      "type App123AppBackendIdentityInput",
      "app123AppBackendIdentityConfig",
      "createApp123AppBackendIdentity",
    ]);
    await expectFileContains(join(out, "backend/src/__tests__/startup.test.ts"), [
      "APP_123_APP_BACKEND_KV_PREFIX",
      "app123AppBackendIdentityConfig",
    ]);
  });

  test("refuses to overwrite an existing output unless --force is passed", async () => {
    const parent = await mkdtemp(join(tmpdir(), "tinyboilerplate-scaffold-"));
    createdRoots.push(parent);
    const out = join(parent, "scratch-app");
    await writeFile(out, "occupied");

    const refused = await runScaffold([
      "--out",
      out,
      "--app-id",
      "xyz.tinycloud.scratch",
      "--app-name",
      "Scratch TinyCloud App",
      "--backend-prefix",
      "xyz.tinycloud.scratch-backend",
      "--frontend-package",
      "@scratch/tinycloud-frontend",
      "--backend-package",
      "@scratch/tinycloud-backend",
      "--frontend-port",
      "5185",
      "--backend-port",
      "3013",
    ]);

    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("already exists");

    const forced = await runScaffold([
      "--force",
      "--out",
      out,
      "--app-id",
      "xyz.tinycloud.scratch",
      "--app-name",
      "Scratch TinyCloud App",
      "--backend-prefix",
      "xyz.tinycloud.scratch-backend",
      "--frontend-package",
      "@scratch/tinycloud-frontend",
      "--backend-package",
      "@scratch/tinycloud-backend",
      "--frontend-port",
      "5185",
      "--backend-port",
      "3013",
    ]);

    expect(forced.exitCode).toBe(0);
    expect(existsSync(join(out, "frontend/package.json"))).toBe(true);
  });

  test("rejects slashes and backslashes in storage identifiers", async () => {
    const parent = await mkdtemp(join(tmpdir(), "tinyboilerplate-scaffold-"));
    createdRoots.push(parent);

    const cases: Array<{
      args: string[];
      option: string;
    }> = [
      {
        args: ["--app-id", "xyz.tinycloud/slash", "--backend-prefix", "ops.valid.backend"],
        option: "app-id",
      },
      {
        args: ["--app-id", "xyz.tinycloud\\slash", "--backend-prefix", "ops.valid.backend"],
        option: "app-id",
      },
      {
        args: ["--app-id", "xyz.tinycloud.valid", "--backend-prefix", "ops/slash/backend"],
        option: "backend-prefix",
      },
      {
        args: ["--app-id", "xyz.tinycloud.valid", "--backend-prefix", "ops\\slash\\backend"],
        option: "backend-prefix",
      },
    ];

    for (const [index, { args, option }] of cases.entries()) {
      const result = await runScaffold([
        "--out",
        join(parent, `invalid-${index}`),
        "--app-name",
        "Invalid TinyCloud App",
        "--frontend-port",
        "5185",
        "--backend-port",
        "3013",
        ...args,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`--${option} must be slash- and backslash-free`);
    }
  });

  test("integration: generated standalone app runs documented install, build, and test sequence", async () => {
    const parent = await mkdtemp(join(tmpdir(), "tinyboilerplate-scaffold-integration-"));
    createdRoots.push(parent);
    const out = join(parent, "standalone-app");

    const result = await runScaffold([
      "--out",
      out,
      "--app-id",
      "xyz.tinycloud.integration",
      "--app-name",
      "Integration TinyCloud App",
      "--backend-prefix",
      "ops.integration.backend",
      "--frontend-package",
      "@integration/tinycloud-frontend",
      "--backend-package",
      "@integration/tinycloud-backend",
      "--frontend-port",
      "5195",
      "--backend-port",
      "3023",
    ]);

    expect(result.exitCode).toBe(0);

    for (const args of [["install"], ["run", "build"], ["run", "test"]]) {
      const command = await runBun(args, out);
      expect(
        command.exitCode,
        `bun ${args.join(" ")} failed${command.timedOut ? " after timeout" : ""}\nstdout:\n${command.stdout}\nstderr:\n${command.stderr}`,
      ).toBe(0);
    }
  }, 420_000);
});

async function runScaffold(args: string[]) {
  const proc = Bun.spawn([process.execPath, scriptPath, ...args], {
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf-8"));
}

async function runBun(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, 180_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).finally(() => clearTimeout(timer));

  return { exitCode, stdout, stderr, timedOut };
}

function expectTree(root: string, paths: string[]) {
  for (const path of paths) {
    expect(existsSync(join(root, path)), path).toBe(true);
  }
}

function expectMissing(root: string, paths: string[]) {
  for (const path of paths) {
    expect(existsSync(join(root, path)), path).toBe(false);
  }
}

async function expectFileContains(path: string, needles: string[]) {
  const content = await readFile(path, "utf-8");
  for (const needle of needles) {
    expect(content, `${path} should contain ${needle}`).toContain(needle);
  }
}

async function expectFileOmits(path: string, needles: string[]) {
  const content = await readFile(path, "utf-8");
  for (const needle of needles) {
    expect(content, `${path} should omit ${needle}`).not.toContain(needle);
  }
}

async function expectGeneratedTextOmits(root: string, needles: string[]) {
  const files = await listGeneratedFiles(root);
  const failures: string[] = [];

  for (const file of files) {
    const content = await readFile(join(root, file), "utf-8");
    for (const needle of needles) {
      if (content.includes(needle)) failures.push(`${file}: ${needle}`);
    }
  }

  expect(failures).toEqual([]);
}

async function listGeneratedPaths(root: string, current = ""): Promise<string[]> {
  const entries = await readdir(join(root, current), { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const relativePath = current ? `${current}/${entry.name}` : entry.name;
    paths.push(relativePath);
    if (entry.isDirectory()) paths.push(...(await listGeneratedPaths(root, relativePath)));
  }

  return paths.sort();
}

async function listGeneratedFiles(root: string, current = ""): Promise<string[]> {
  const entries = await readdir(join(root, current), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listGeneratedFiles(root, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }

  return files.sort();
}

function isGeneratedArtifactPath(path: string): boolean {
  return (
    path.split("/").some((part) => generatedArtifactNames.has(part)) ||
    path.endsWith(".tsbuildinfo")
  );
}

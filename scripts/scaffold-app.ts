#!/usr/bin/env bun
import { existsSync } from "fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

interface ScaffoldOptions {
  appId: string;
  appName: string;
  backendPackage: string;
  backendPort: string;
  backendPrefix: string;
  codeName: CodeName;
  force: boolean;
  frontendPackage: string;
  frontendPort: string;
  out: string;
}

interface CodeName {
  camel: string;
  pascal: string;
  upper: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const generatedNames = new Set(["dist", ".turbo", "node_modules"]);
const requiredOptions = [
  "out",
  "app-id",
  "app-name",
  "backend-prefix",
  "frontend-port",
  "backend-port",
];

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usageText());
    return;
  }

  const options = parseArgs(args);
  const outDir = resolve(process.cwd(), options.out);

  if (existsSync(outDir)) {
    if (!options.force) {
      throw new Error(`Output already exists: ${outDir}. Pass --force to replace it.`);
    }
    await rm(outDir, { force: true, recursive: true });
  }

  await mkdir(outDir, { recursive: true });
  await copyDirectoryContents(join(repoRoot, "templates/app-starter"), outDir);
  await mkdir(join(outDir, "packages"), { recursive: true });
  for (const packageName of ["core", "client", "server"]) {
    await copyDirectory(
      join(repoRoot, "packages", packageName),
      join(outDir, "packages", packageName),
    );
  }
  await copyFile(join(repoRoot, "tsconfig.base.json"), join(outDir, "tsconfig.base.json"));
  await copyFile(join(repoRoot, "turbo.json"), join(outDir, "turbo.json"));
  await copyFile(join(repoRoot, "eslint.config.js"), join(outDir, "eslint.config.js"));
  await copyFile(join(repoRoot, ".gitignore"), join(outDir, ".gitignore"));

  await writeRootPackageJson(outDir, options);
  await rewriteJsonFiles(outDir, options);
  await rewriteTextFiles(outDir, options);

  console.log(`Scaffolded ${options.appName} at ${outDir}`);
}

function parseArgs(args: string[]): ScaffoldOptions {
  const values = new Map<string, string>();
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);

    const equalIndex = arg.indexOf("=");
    if (equalIndex >= 0) {
      values.set(arg.slice(2, equalIndex), arg.slice(equalIndex + 1));
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    values.set(arg.slice(2), value);
    index += 1;
  }

  const missing = requiredOptions.filter((key) => !values.get(key));
  if (missing.length > 0) {
    throw new Error(`Missing required option(s): ${missing.map((key) => `--${key}`).join(", ")}`);
  }

  const appId = values.get("app-id")!;
  const backendPrefix = values.get("backend-prefix")!;
  validateStorageIdentifier(appId, "app-id");
  validateStorageIdentifier(backendPrefix, "backend-prefix");

  return {
    appId: values.get("app-id")!,
    appName: values.get("app-name")!,
    backendPort: normalizePort(values.get("backend-port")!, "backend-port"),
    backendPrefix,
    codeName: codeNameFromAppId(appId),
    force,
    backendPackage: values.get("backend-package") ?? `${packageNameFromAppId(appId)}-backend`,
    frontendPackage: values.get("frontend-package") ?? `${packageNameFromAppId(appId)}-frontend`,
    frontendPort: normalizePort(values.get("frontend-port")!, "frontend-port"),
    out: values.get("out")!,
  };
}

function usageText(): string {
  return `Usage:
  bun scripts/scaffold-app.ts --out <dir> --app-id <id> --app-name <name> --backend-prefix <prefix> --frontend-port <port> --backend-port <port> [--frontend-package <name>] [--backend-package <name>] [--force]

Required options:
  --out <dir>                  Output directory for the standalone app
  --app-id <id>                TinyCloud app id; must be slash- and backslash-free
  --app-name <name>            Human-readable app name
  --backend-prefix <prefix>    Backend-owned operational prefix; must be slash- and backslash-free
  --frontend-port <port>       Frontend dev server numeric port
  --backend-port <port>        Backend dev server numeric port

Optional:
  --frontend-package <name>    Generated frontend package name; defaults to a name derived from app id
  --backend-package <name>     Generated backend package name; defaults to a name derived from app id
  --force                      Replace an existing output directory
  --help, -h                   Print this help

Example:
  bun scripts/scaffold-app.ts --out ../scratch-app --app-id xyz.tinycloud.scratch --app-name "Scratch TinyCloud App" --backend-prefix ops.scratch.backend --frontend-package @scratch/tinycloud-frontend --backend-package @scratch/tinycloud-backend --frontend-port 5185 --backend-port 3013`;
}

function validateStorageIdentifier(value: string, option: string): void {
  if (value.includes("/") || value.includes("\\")) {
    throw new Error(`--${option} must be slash- and backslash-free`);
  }
}

function normalizePort(value: string, option: string): string {
  if (!/^\d+$/.test(value)) throw new Error(`--${option} must be a numeric port`);
  return value;
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  if (shouldExclude(source)) return;
  await mkdir(destination, { recursive: true });
  await copyDirectoryContents(source, destination);
}

async function copyDirectoryContents(source: string, destination: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  await mkdir(destination, { recursive: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    if (shouldExclude(sourcePath)) continue;

    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await mkdir(dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
    } else if (entry.isSymbolicLink()) {
      const targetStat = await stat(sourcePath);
      if (targetStat.isDirectory()) await copyDirectory(sourcePath, destinationPath);
      else if (targetStat.isFile()) await copyFile(sourcePath, destinationPath);
    }
  }
}

function shouldExclude(path: string): boolean {
  const name = basename(path);
  return generatedNames.has(name) || name.endsWith(".tsbuildinfo");
}

async function writeRootPackageJson(outDir: string, options: ScaffoldOptions): Promise<void> {
  const sourcePackage = await readJson(join(repoRoot, "package.json"));
  const rootPackage = {
    name: packageNameFromAppId(options.appId),
    private: true,
    type: "module",
    packageManager: sourcePackage.packageManager,
    workspaces: ["packages/*", "frontend", "backend"],
    overrides: sourcePackage.overrides ?? {},
    scripts: {
      dev: `turbo run dev --filter=${options.frontendPackage} --filter=${options.backendPackage}`,
      "build:packages":
        "turbo run build --filter=@tinyboilerplate/core --filter=@tinyboilerplate/client --filter=@tinyboilerplate/server",
      "build:backend": "bun run --cwd backend build",
      "build:frontend": "bun run --cwd frontend build",
      "test:backend": "bun run --cwd backend test",
      "test:packages":
        "bun run --cwd packages/core test && bun run --cwd packages/client test && bun run --cwd packages/server test",
      build: "bun run build:packages && bun run build:backend && bun run build:frontend",
      test: "bun run test:backend && bun run test:packages",
      lint: "eslint .",
      "lint:fix": "eslint . --fix",
      "generate-key": "bun run packages/server/scripts/generate-key.ts backend/.env",
      postinstall:
        "node packages/client/scripts/fix-web-wasm-init.mjs && node packages/server/scripts/fix-wasm-esm.mjs",
    },
    devDependencies: sourcePackage.devDependencies ?? {},
  };

  await writeJson(join(outDir, "package.json"), rootPackage);
}

function packageNameFromAppId(appId: string): string {
  const name = appId
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/\./g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "tinycloud-app";
}

function codeNameFromAppId(appId: string): CodeName {
  const leaf = appId.split(".").filter(Boolean).at(-1) ?? "app";
  const words = leaf
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const safeWords = words.length > 0 ? words : ["app"];
  const basePascal = safeWords.map(capitalize).join("");
  const pascal = startsWithIdentifierCharacter(basePascal) ? basePascal : `App${basePascal}`;
  const camel = `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
  const baseUpper = safeWords.map((word) => word.toUpperCase()).join("_");
  const upper = startsWithIdentifierCharacter(baseUpper) ? baseUpper : `APP_${baseUpper}`;
  return { camel, pascal, upper };
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function startsWithIdentifierCharacter(value: string): boolean {
  return /^[A-Za-z_$]/.test(value);
}

async function rewriteJsonFiles(outDir: string, options: ScaffoldOptions): Promise<void> {
  const manifestPath = join(outDir, "manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.app_id = options.appId;
  manifest.name = options.appName;
  await writeJson(manifestPath, manifest);

  const frontendPackagePath = join(outDir, "frontend/package.json");
  const frontendPackage = await readJson(frontendPackagePath);
  frontendPackage.name = options.frontendPackage;
  await writeJson(frontendPackagePath, frontendPackage);

  const backendPackagePath = join(outDir, "backend/package.json");
  const backendPackage = await readJson(backendPackagePath);
  backendPackage.name = options.backendPackage;
  await writeJson(backendPackagePath, backendPackage);

  await rewriteTsconfig(join(outDir, "frontend/tsconfig.json"), "../tsconfig.base.json");
  await rewriteTsconfig(join(outDir, "backend/tsconfig.json"), "../tsconfig.base.json");
  for (const packageName of ["core", "client", "server"]) {
    await rewriteTsconfig(
      join(outDir, "packages", packageName, "tsconfig.json"),
      "../../tsconfig.base.json",
    );
  }
}

async function rewriteTsconfig(path: string, extendsPath: string): Promise<void> {
  const config = await readJson(path);
  const { extends: _oldExtends, ...rest } = config;
  await writeJson(path, { extends: extendsPath, ...rest });
}

async function rewriteTextFiles(outDir: string, options: ScaffoldOptions): Promise<void> {
  const commonReplacements: Array<[string, string]> = [
    ["xyz.tinycloud.app-starter-backend", options.backendPrefix],
    ["xyz.tinycloud.app-starter", options.appId],
    ["@tinyboilerplate/app-starter-frontend", options.frontendPackage],
    ["@tinyboilerplate/app-starter-backend", options.backendPackage],
    ["TinyCloud App Starter Backend", `${options.appName} Backend`],
    ["TinyCloud App Starter API", `${options.appName} API`],
    ["TinyCloud App Starter", options.appName],
  ];

  await replaceInFile(join(outDir, "README.md"), [
    ...commonReplacements,
    ["bun run dev:app-starter", "bun run dev"],
    ["localhost:5175", `localhost:${options.frontendPort}`],
    ["localhost:3003", `localhost:${options.backendPort}`],
  ]);
  await rewriteGeneratedReadme(join(outDir, "README.md"));

  await replaceInFile(join(outDir, "backend/.env.example"), [
    ["PORT=3003", `PORT=${options.backendPort}`],
    ["localhost:5175", `localhost:${options.frontendPort}`],
  ]);
  await replaceInFile(join(outDir, "frontend/.env.example"), [
    ["localhost:5175", `localhost:${options.frontendPort}`],
    ["localhost:3003", `localhost:${options.backendPort}`],
  ]);

  await replaceInFile(join(outDir, "backend/openapi.yaml"), [
    ["title: TinyCloud App Starter API", `title: ${yamlScalar(`${options.appName} API`)}`],
    [
      "description: API contract for the reusable TinyCloud app starter backend.",
      `description: ${yamlScalar(`API contract for the ${options.appName} backend.`)}`,
    ],
  ]);

  await replaceInFile(join(outDir, "backend/src/manifest.ts"), [
    [
      'export const APP_ID = "xyz.tinycloud.app-starter";',
      `export const APP_ID = ${tsString(options.appId)};`,
    ],
    [
      'const BACKEND_DELEGATION_NAME = "TinyCloud App Starter Backend";',
      `const BACKEND_DELEGATION_NAME = ${tsString(`${options.appName} Backend`)};`,
    ],
    [
      'description: "Read and write the TinyCloud App Starter storage probe.",',
      `description: ${tsString(`Read and write the ${options.appName} storage probe.`)},`,
    ],
    [
      'throw new Error("TinyCloud App Starter manifest must use defaults: false");',
      `throw new Error(${tsString(`${options.appName} manifest must use defaults: false`)});`,
    ],
    [
      'throw new Error("TinyCloud App Starter manifest must declare explicit permissions");',
      `throw new Error(${tsString(`${options.appName} manifest must declare explicit permissions`)});`,
    ],
    ["AppStarterManifest", `${options.codeName.pascal}Manifest`],
    ["validateAppStarterManifest", `validate${options.codeName.pascal}Manifest`],
  ]);

  await replaceInFile(join(outDir, "backend/src/startup.ts"), [
    ['import { APP_ID } from "./manifest.js";\n\n', ""],
    [
      "export const APP_STARTER_BACKEND_KV_PREFIX = `${APP_ID}-backend`;",
      `export const ${options.codeName.upper}_BACKEND_KV_PREFIX = ${tsString(options.backendPrefix)};`,
    ],
    ["APP_STARTER_BACKEND_KV_PREFIX", `${options.codeName.upper}_BACKEND_KV_PREFIX`],
    ["AppStarterBackendIdentityInput", `${options.codeName.pascal}BackendIdentityInput`],
    ["appStarterBackendIdentityConfig", `${options.codeName.camel}BackendIdentityConfig`],
    ["createAppStarterBackendIdentity", `create${options.codeName.pascal}BackendIdentity`],
  ]);

  await replaceInFile(join(outDir, "backend/src/index.ts"), [
    ["createAppStarterBackendIdentity", `create${options.codeName.pascal}BackendIdentity`],
    ['process.env.PORT ?? "3003"', `process.env.PORT ?? "${options.backendPort}"`],
    ["localhost:5175", `localhost:${options.frontendPort}`],
    [
      "`TinyCloud App Starter backend ready: https://localhost:${PORT}`",
      tsTemplateExpression(`${options.appName} backend ready: https://localhost:`, "PORT"),
    ],
    [
      "`TinyCloud App Starter backend ready: http://localhost:${PORT}`",
      tsTemplateExpression(`${options.appName} backend ready: http://localhost:`, "PORT"),
    ],
    [
      '"Failed to start TinyCloud App Starter backend:"',
      tsString(`Failed to start ${options.appName} backend:`),
    ],
  ]);

  await replaceInFile(join(outDir, "frontend/src/App.tsx"), [
    ["localhost:3003", `localhost:${options.backendPort}`],
    ['const APP_NAME = "TinyCloud App Starter";', `const APP_NAME = ${tsString(options.appName)};`],
    [
      'new SessionStore("tinycloud-app-starter:session")',
      `new SessionStore(${tsString(`${options.appId}:session`)})`,
    ],
    ["<h1>App Starter</h1>", `<h1>{${tsString(options.appName)}}</h1>`],
  ]);
  await replaceInFile(join(outDir, "frontend/index.html"), [
    ["<title>TinyCloud App Starter</title>", `<title>${escapeHtmlText(options.appName)}</title>`],
  ]);
  await replaceInFile(join(outDir, "frontend/vite.config.ts"), [
    ["port: 5175", `port: ${options.frontendPort}`],
  ]);

  const backendTestFiles = [
    "backend/src/__tests__/delegations.test.ts",
    "backend/src/__tests__/manifest.test.ts",
    "backend/src/__tests__/openapi.test.ts",
    "backend/src/__tests__/portable-delegation.test.ts",
    "backend/src/__tests__/server-info.test.ts",
    "backend/src/__tests__/startup.test.ts",
  ];
  for (const file of backendTestFiles) {
    await replaceInFile(join(outDir, file), [
      ["xyz.tinycloud.app-starter-backend", tsStringContent(options.backendPrefix)],
      ["xyz.tinycloud.app-starter", tsStringContent(options.appId)],
      ["@tinyboilerplate/app-starter-frontend", options.frontendPackage],
      ["@tinyboilerplate/app-starter-backend", options.backendPackage],
      ["TinyCloud App Starter Backend", tsStringContent(`${options.appName} Backend`)],
      ["TinyCloud App Starter API", tsStringContent(`${options.appName} API`)],
      ["TinyCloud App Starter", tsStringContent(options.appName)],
      ["APP_STARTER_BACKEND_KV_PREFIX", `${options.codeName.upper}_BACKEND_KV_PREFIX`],
      ["appStarterBackendIdentityConfig", `${options.codeName.camel}BackendIdentityConfig`],
      ["App Starter OpenAPI spec", tsStringContent(`${options.appName} OpenAPI spec`)],
      [
        "app starter backend startup config",
        tsStringContent(`${options.appName.toLowerCase()} backend startup config`),
      ],
      [
        `expect(${options.codeName.upper}_BACKEND_KV_PREFIX).toBe(\`\${APP_ID}-backend\`);\n    `,
        "",
      ],
      ['import { APP_ID } from "../manifest.js";\n', ""],
    ]);
  }
}

async function rewriteGeneratedReadme(path: string): Promise<void> {
  let content = await readFile(path, "utf-8");
  content = content
    .replace("The default ids are:", "This app was generated with:")
    .replace("Template defaults are:", "This app was generated with:");
  const verificationStart = content.indexOf("## Verification");
  const scaffoldingStart = content.indexOf("## Scaffolding From This Template");
  if (verificationStart >= 0 && scaffoldingStart > verificationStart) {
    const standaloneVerification = [
      "## Verification",
      "",
      "Use build and root tests as unauthenticated smoke checks:",
      "",
      "```bash",
      "bun run build",
      "bun run test",
      "```",
      "",
      "Those checks do not exercise OpenKey, WebAuthn, TinyCloud space setup, or the",
      "browser delegation grant. For runtime verification, start the app, sign in in a",
      "browser, grant the backend policy, then read and update the probe. Use HTTP",
      "localhost or a trusted HTTPS localhost certificate; do not treat a browser TLS",
      "warning page as a valid passkey test environment.",
      "",
      "",
    ].join("\n");
    content = `${content.slice(0, verificationStart)}${standaloneVerification}${content.slice(
      scaffoldingStart,
    )}`;
  }

  const start = content.indexOf("## Scaffolding From This Template");
  const end = content.indexOf("The only app data route is the storage probe:");
  if (start < 0 || end < 0) return;

  const standaloneSection = [
    "## Standalone App",
    "",
    "This scaffold is ready to install and run on its own. It includes the app",
    "template, shared workspace packages, root workspace config, and generated app",
    "metadata.",
    "",
    "```bash",
    "bun install",
    "bun run generate-key",
    "bun run build",
    "bun run test",
    "```",
    "",
    "`bun run generate-key` writes `BACKEND_PRIVATE_KEY` to `backend/.env`,",
    "where the backend dev server reads it.",
    "",
    "The root test command runs the backend tests and copied shared package tests.",
    "",
    "",
  ].join("\n");
  await writeFile(path, `${content.slice(0, start)}${standaloneSection}${content.slice(end)}`);
}

async function replaceInFile(path: string, replacements: Array<[string, string]>): Promise<void> {
  let content = await readFile(path, "utf-8");
  for (const [from, to] of replacements) {
    content = content.split(from).join(to);
  }
  await writeFile(path, content);
}

function tsString(value: string): string {
  return JSON.stringify(value);
}

function tsStringContent(value: string): string {
  return tsString(value).slice(1, -1);
}

function tsTemplateExpression(prefix: string, interpolationName: string): string {
  return `\`${escapeTemplateText(prefix)}\${${interpolationName}}\``;
}

function escapeTemplateText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf-8"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

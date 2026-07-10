import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Adoption contract for F4 (handoff §3 P1 / §4 test strategy).
//
// packages/server/src/__tests__/rate-limits.test.ts proves the MECHANISM
// (applyRateLimiter sets `trust proxy` and creates IP-keyed buckets). Nothing
// there proves ADOPTION: if a refactor silently dropped the applyRateLimiter(app)
// call from a backend that mounts an Express app, every mechanism test would still
// pass and every scaffolded app would ship a broken rate limiter behind an ingress
// (all users on one IP bucket; express-rate-limit throws on X-Forwarded-For without
// trust proxy). This is the same bug class as F1's manifest-DDL contract — so this
// test is modeled directly on test/manifest-ddl-contract.test.ts.
//
// Invariant asserted (NOT a hardcoded app list): every discovered app backend that
// mounts an Express app imports `applyRateLimiter` from `@tinyboilerplate/server`
// AND calls it. The P3 examples/tasks example is covered automatically the day it
// lands, because backends are discovered by walking the filesystem.

const REPO_ROOT = resolve(import.meta.dir, "..");

// Creation of an Express app instance: `express()` with no member access.
// `express.json(...)`, `express.static(...)` etc. do NOT match (a `.member` sits
// between the identifier and the paren).
const EXPRESS_APP_PATTERN = /\bexpress\s*\(\s*\)/;

// A CALL to applyRateLimiter — `applyRateLimiter(app)`, `applyRateLimiter( app )`,
// multiline args, etc. The bare identifier in an import specifier is followed by
// `,`/newline/`}`, never `(`, so this does not match the import itself.
const APPLY_CALL_PATTERN = /\bapplyRateLimiter\s*\(/;

const SERVER_PACKAGE = "@tinyboilerplate/server";

function walkTs(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkTs(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function appsDirEntries(): string[] {
  const roots = [join(REPO_ROOT, "templates"), join(REPO_ROOT, "examples")];
  const apps: string[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      apps.push(join(root, entry));
    }
  }
  return apps;
}

// Prefer a structural read over a raw grep: parse each import statement's brace
// block + module specifier (regex, because we must analyze source statically —
// importing index.ts has side effects: it calls main() and process.exit()s without
// BACKEND_PRIVATE_KEY). Robust to the multi-line named-import blocks these backends
// actually use.
const IMPORT_STATEMENT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

function importsApplyRateLimiterFromServer(src: string): boolean {
  for (const match of src.matchAll(IMPORT_STATEMENT)) {
    const specifier = match[2];
    if (specifier !== SERVER_PACKAGE) continue;
    const named = match[1]
      .split(",")
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter(Boolean);
    if (named.includes("applyRateLimiter")) return true;
  }
  return false;
}

/** Does this backend mount an Express app anywhere in its source? */
function mountsExpressApp(backendSrc: string): boolean {
  for (const file of walkTs(backendSrc)) {
    if (EXPRESS_APP_PATTERN.test(stripComments(readFileSync(file, "utf-8")))) return true;
  }
  return false;
}

/** Does this backend both import applyRateLimiter from the server pkg AND call it? */
function adoptsRateLimiter(backendSrc: string): { imported: boolean; called: boolean } {
  let imported = false;
  let called = false;
  for (const file of walkTs(backendSrc)) {
    const src = stripComments(readFileSync(file, "utf-8"));
    if (importsApplyRateLimiterFromServer(src)) imported = true;
    if (APPLY_CALL_PATTERN.test(src)) called = true;
  }
  return { imported, called };
}

describe("rate limiter adoption contract", () => {
  it("every app backend that mounts an Express app imports and calls applyRateLimiter", () => {
    const apps = appsDirEntries();
    const backends: string[] = [];
    const violations: string[] = [];

    for (const appDir of apps) {
      const backendSrc = join(appDir, "backend", "src");
      if (!mountsExpressApp(backendSrc)) continue;
      backends.push(appDir.replace(REPO_ROOT + "/", ""));
      const { imported, called } = adoptsRateLimiter(backendSrc);
      if (!imported || !called) {
        const missing = [
          !imported && `import from ${SERVER_PACKAGE}`,
          !called && "applyRateLimiter(app) call",
        ]
          .filter(Boolean)
          .join(" + ");
        violations.push(`${appDir.replace(REPO_ROOT + "/", "")} (missing: ${missing})`);
      }
    }

    // Guard against a vacuous pass: the discovery loop must actually find backends.
    // If this fails, the walk is broken, not the product.
    expect(backends.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});

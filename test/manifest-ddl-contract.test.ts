// Contract: every app whose source issues DDL must grant tinycloud.sql/schema.
//
// MECHANISM (measured live 2026-07-08). The gate on DDL is the SDK, not the node.
// @tinycloud/sdk-services@2.4.2 introduced SQLAction.SCHEMA and routes ALL DDL
// through the ability tinycloud.sql/schema. A delegation lacking "schema" is
// therefore rejected at the layer-1 ReCap capability check before the node's
// rusqlite authorizer is ever consulted. This test asserts that invariant
// statically, including browser-direct storage such as the Tasks example.
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const APP_ROOTS = [join(REPO_ROOT, "templates"), join(REPO_ROOT, "examples")];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".turbo"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// Keep this table deliberately explicit: adding an SDK-schema-gated DDL form is
// one row, and every form inherits case/whitespace/comment tolerance below.
const DDL_FORMS = [
  { name: "CREATE TABLE", keywords: ["CREATE", "TABLE"] },
  { name: "ALTER TABLE", keywords: ["ALTER", "TABLE"] },
  { name: "DROP TABLE", keywords: ["DROP", "TABLE"] },
  { name: "CREATE INDEX", keywords: ["CREATE", "INDEX"] },
  { name: "DROP INDEX", keywords: ["DROP", "INDEX"] },
  { name: "CREATE VIEW", keywords: ["CREATE", "VIEW"] },
  { name: "DROP VIEW", keywords: ["DROP", "VIEW"] },
  { name: "CREATE TRIGGER", keywords: ["CREATE", "TRIGGER"] },
  { name: "DROP TRIGGER", keywords: ["DROP", "TRIGGER"] },
  { name: "CREATE VIRTUAL TABLE", keywords: ["CREATE", "VIRTUAL", "TABLE"] },
  { name: "REINDEX", keywords: ["REINDEX"] },
] as const;

// SQL supports block comments and -- comments; source can also carry JS //
// comments around a SQL template. Treat every one as a keyword separator.
const SQL_GAP = String.raw`(?:\s+|/\*[\s\S]*?\*/|--[^\r\n]*(?:\r\n|\r|\n|$)|//[^\r\n]*(?:\r\n|\r|\n|$))+`;
const DDL_PATTERNS = DDL_FORMS.map(
  ({ keywords }) => new RegExp(`\\b${keywords.join(`\\b${SQL_GAP}\\b`)}\\b`, "i"),
);

function hasDdlStatement(source: string): boolean {
  return DDL_PATTERNS.some((pattern) => pattern.test(source));
}

function stripSourceComments(source: string): string {
  // Preserve separators so CREATE /* migration */ TABLE remains detectable while
  // a DDL-looking JavaScript comment cannot require an unused manifest grant.
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ");
}

function walkDirectories(dir: string): string[] {
  const directories: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      directories.push(full, ...walkDirectories(full));
    }
  } catch {
    return directories;
  }

  return directories;
}

function discoverAppDirs(): string[] {
  return APP_ROOTS.flatMap((root) =>
    walkDirectories(root).filter((dir) => existsSync(join(dir, "manifest.json"))),
  );
}

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkSourceFiles(full));
        continue;
      }
      const extension = entry.name.slice(entry.name.lastIndexOf("."));
      if (entry.isFile() && SOURCE_EXTENSIONS.has(extension)) files.push(full);
    }
  } catch {
    return files;
  }

  return files;
}

function appSourceRoots(appDir: string): string[] {
  return [join(appDir, "backend", "src"), join(appDir, "frontend", "src")];
}

function ddlFiles(appDir: string): string[] {
  return appSourceRoots(appDir)
    .flatMap(walkSourceFiles)
    .filter((file) => hasDdlStatement(stripSourceComments(readFileSync(file, "utf-8"))));
}

function getSqlActions(manifestPath: string): string[] | null {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf-8");
  } catch {
    return null;
  }
  const manifest = JSON.parse(raw) as {
    permissions?: Array<{ service?: string; actions?: string[] }>;
  };
  const perm = manifest.permissions?.find((p) => p.service === "tinycloud.sql");
  return perm?.actions ?? null;
}

function ddlManifestViolations(
  appDirs: readonly string[],
  actionsForApp = (appDir: string) => getSqlActions(join(appDir, "manifest.json")),
): string[] {
  return appDirs.flatMap((appDir) => {
    if (ddlFiles(appDir).length === 0) return [];
    return actionsForApp(appDir)?.includes("schema") ? [] : [relative(REPO_ROOT, appDir)];
  });
}

describe("manifest DDL contract", () => {
  it("every app whose source issues DDL grants tinycloud.sql/schema", () => {
    const apps = discoverAppDirs();

    expect(apps.length).toBeGreaterThan(0);
    expect(ddlManifestViolations(apps)).toEqual([]);
  });

  it("recognizes all tracked DDL forms through comments and mixed case", () => {
    for (const form of DDL_FORMS) {
      const statement = `/* leading migration comment */\n-- line migration comment\n${form.keywords
        .map((keyword, index) => (index % 2 === 0 ? keyword.toLowerCase() : keyword))
        .join(" /* migration */ \n ")} example_object`;
      expect(hasDdlStatement(statement)).toBe(true);
    }

    expect(hasDdlStatement("/* leading */ INSERT INTO tasks VALUES (1)")).toBe(false);
  });

  it("would reject a missing schema grant for Tasks' frontend DDL", () => {
    const tasksDir = join(REPO_ROOT, "examples", "tasks");
    const tasksActions = getSqlActions(join(tasksDir, "manifest.json"));

    // This anchors the mutation vector to the browser-direct app rather than a
    // backend fixture: deleting schema from its manifest makes the main contract
    // red, while this in-memory mutation proves the failure path without editing it.
    expect(discoverAppDirs()).toContain(tasksDir);
    expect(ddlFiles(tasksDir).map((file) => relative(REPO_ROOT, file))).toContain(
      "examples/tasks/frontend/src/lib/taskStore.ts",
    );
    expect(tasksActions).toContain("schema");
    expect(
      ddlManifestViolations(
        [tasksDir],
        () => tasksActions?.filter((action) => action !== "schema") ?? null,
      ),
    ).toEqual(["examples/tasks"]);
  });
});

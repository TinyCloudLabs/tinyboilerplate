import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const packageRoots = ["templates/app-starter", "examples/notes"];
const errors = [];

for (const packageRoot of packageRoots) {
  validatePackage(join(root, packageRoot));
}

if (errors.length > 0) {
  for (const error of errors) console.error(`check: ${error}`);
  process.exit(1);
}

console.log("check: app packages ok");

function validatePackage(packageRoot) {
  const manifestPath = join(packageRoot, "manifest.json");
  const manifest = readJson(manifestPath);
  if (!manifest) return;

  if (!manifest.app_id || typeof manifest.app_id !== "string") {
    fail(manifestPath, "manifest.app_id must be a non-empty string");
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    fail(manifestPath, "manifest.name must be a non-empty string");
  }

  const knowledge = manifest.knowledge;
  if (knowledge !== true && typeof knowledge !== "string") {
    fail(manifestPath, "manifest.knowledge must be true or a knowledge/*.md path");
    return;
  }
  if (typeof knowledge === "string" && !/^knowledge\/.+\.md$/.test(knowledge)) {
    fail(manifestPath, "manifest.knowledge path must match knowledge/*.md");
  }

  const rootPath = knowledge === true ? "knowledge/index.md" : knowledge;
  const knowledgeRootPath = join(packageRoot, rootPath);
  if (!existsSync(knowledgeRootPath)) {
    fail(manifestPath, `knowledge root ${rootPath} does not exist`);
  }

  for (const path of walk(join(packageRoot, "knowledge"), (entry) => entry.endsWith(".md"))) {
    validateKnowledgeFile(path, manifest.app_id);
  }
}

function validateKnowledgeFile(path, appId) {
  const content = readFileSync(path, "utf8");
  if (!content.startsWith("---\n")) {
    fail(path, "knowledge file must start with frontmatter");
  }
  if (!content.includes("containsSecretValue: false")) {
    fail(path, "knowledge frontmatter must include containsSecretValue: false");
  }
  if (!content.includes(`app: ${appId}`)) {
    fail(path, `knowledge frontmatter must identify app ${appId}`);
  }

  const suspiciousSecretPattern =
    /\b(api[_-]?key|secret|private[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{16,}/i;
  if (suspiciousSecretPattern.test(content)) {
    fail(path, "knowledge file appears to contain a secret-like value");
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(path, `is not valid JSON: ${error.message}`);
    return undefined;
  }
}

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, predicate, out);
    else if (predicate(path)) out.push(path);
  }
  return out;
}

function fail(path, message) {
  errors.push(`${relative(root, path)} ${message}`);
}

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const workflowPath = join(repoRoot, ".github/workflows/real-auth.yml");

function readWorkflow(): string {
  expect(existsSync(workflowPath), "real-auth workflow should exist").toBe(true);
  return readFileSync(workflowPath, "utf8");
}

function triggerNames(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const onLineIndex = lines.findIndex((line) => line === "on:");
  expect(onLineIndex, "workflow should declare a top-level on block").toBeGreaterThanOrEqual(0);

  const triggers: string[] = [];
  for (const line of lines.slice(onLineIndex + 1)) {
    if (line.length > 0 && !line.startsWith(" ")) break;
    const match = line.match(/^ {2}([a-zA-Z_][a-zA-Z0-9_-]*):/);
    if (match) triggers.push(match[1]);
  }

  return triggers;
}

describe("real-auth manual workflow", () => {
  test("is manual-only and documents credential fixture requirements", () => {
    const workflow = readWorkflow();

    expect(triggerNames(workflow)).toEqual(["workflow_dispatch"]);
    expect(workflow).toContain("REAL_AUTH_STORAGE_STATE_B64");
    expect(workflow).toContain("REAL_AUTH_METADATA_B64");
    expect(workflow).toContain("REAL_AUTH_BACKEND_PRIVATE_KEY");
  });

  test("scopes credential fixture secrets to the restore step", () => {
    const workflow = readWorkflow();

    expect(workflow).not.toContain("    env:\n      REAL_AUTH_STORAGE_STATE_B64");
    expect(workflow).toContain(`      - name: Restore credential fixture
        env:
          REAL_AUTH_STORAGE_STATE_B64: \${{ secrets.REAL_AUTH_STORAGE_STATE_B64 }}
          REAL_AUTH_METADATA_B64: \${{ secrets.REAL_AUTH_METADATA_B64 }}
          REAL_AUTH_BACKEND_PRIVATE_KEY: \${{ secrets.REAL_AUTH_BACKEND_PRIVATE_KEY }}`);
  });

  test("runs only from main behind the real-auth replay environment", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("if: ${{ github.ref == 'refs/heads/main' }}");
    expect(workflow).toContain(`    environment:
      name: real-auth-replay`);
  });

  test("restores the fixture locally and runs replay against app-starter", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("mkdir -p .auth templates/app-starter/backend");
    expect(workflow).toContain("base64 --decode > .auth/tinycloud-real-auth.json");
    expect(workflow).toContain("base64 --decode > .auth/tinycloud-real-auth.meta.json");
    expect(workflow).toContain(
      "REAL_AUTH_BACKEND_PRIVATE_KEY: ${{ secrets.REAL_AUTH_BACKEND_PRIVATE_KEY }}",
    );
    expect(workflow).toContain(
      "printf 'BACKEND_PRIVATE_KEY=%s\\n' \"${REAL_AUTH_BACKEND_PRIVATE_KEY}\" > templates/app-starter/backend/.env",
    );
    expect(workflow).toContain("bun run dev");
    expect(workflow).toContain("bun run test:real-auth");
  });

  test("does not upload saved auth state or browser artifacts", () => {
    const workflow = readWorkflow();

    expect(workflow).not.toContain("actions/upload-artifact");
  });

  test("uses trusted local HTTPS without browser certificate bypasses", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("LOCAL_CA_CERT=%s/rootCA.pem");
    expect(workflow).toContain('curl_args+=(--cacert "${LOCAL_CA_CERT}")');
    expect(workflow).not.toContain("REAL_AUTH_IGNORE_HTTPS_ERRORS=1");
    expect(workflow).not.toContain("curl -k");
  });
});

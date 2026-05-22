import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRealAuthCommandEnv } from "./real-auth-fixture.ts";

const command = process.argv[2];
if (command !== "setup" && command !== "replay") {
  console.error("Usage: bun real-auth-command.ts <setup|replay>");
  process.exit(1);
}

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..");
const script = command === "setup" ? "real-auth-setup.ts" : "real-auth-replay.ts";
const env = resolveRealAuthCommandEnv({ cwd: repoRoot, env: process.env });

const child = Bun.spawn([process.execPath, script], {
  cwd: testDir,
  env,
  stderr: "inherit",
  stdin: "inherit",
  stdout: "inherit",
});

process.exit(await child.exited);

import { chromium } from "playwright";
import { existsSync } from "fs";
import { join } from "path";
import net from "net";

interface FrontendSmokeTarget {
  buttonName: RegExp;
  cwd: string;
  heading: string;
  name: string;
  port: number;
  title: string;
}

const repoRoot = new URL("..", import.meta.url).pathname;
const targets: FrontendSmokeTarget[] = [
  {
    buttonName: /sign in/i,
    cwd: "templates/app-starter/frontend",
    heading: "App Starter",
    name: "app-starter",
    port: 6175,
    title: "TinyCloud App Starter",
  },
  {
    buttonName: /connect/i,
    cwd: "examples/notes/frontend",
    heading: "Notes",
    name: "notes",
    port: 6174,
    title: "TinyCloud Notes",
  },
];

for (const target of targets) {
  await smokeFrontend(target);
}

async function smokeFrontend(target: FrontendSmokeTarget): Promise<void> {
  const proc = Bun.spawn(
    [process.execPath, "run", "dev", "--", "--host", "127.0.0.1", "--port", String(target.port)],
    {
      cwd: join(repoRoot, target.cwd),
      env: {
        ...process.env,
        VITE_BACKEND_URL: "http://127.0.0.1:9",
      },
      stderr: "ignore",
      stdout: "ignore",
    },
  );

  try {
    await waitForTcp(target.port);
    const usesHttps = existsSync(join(repoRoot, target.cwd, "localhost.pem"));
    const url = `${usesHttps ? "https" : "http"}://127.0.0.1:${target.port}`;

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));

      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: target.heading }).waitFor();
      await page.getByRole("button", { name: target.buttonName }).waitFor();

      const title = await page.title();
      if (title !== target.title) {
        throw new Error(
          `${target.name} title mismatch: expected "${target.title}", got "${title}"`,
        );
      }
      if (consoleErrors.length || pageErrors.length) {
        throw new Error(
          `${target.name} browser errors:\n${[...consoleErrors, ...pageErrors].join("\n")}`,
        );
      }
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    proc.kill();
    await proc.exited.catch(() => undefined);
  }
}

async function waitForTcp(port: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
          socket.end();
          resolve();
        });
        socket.once("error", reject);
        socket.setTimeout(1_000, () => {
          socket.destroy(new Error("Timed out waiting for TCP connection"));
        });
      });
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for 127.0.0.1:${port}: ${errorMessage(lastError)}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { chromium } from "playwright";
import { existsSync, readFileSync } from "fs";
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
    buttonName: /sign in/i,
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

await smokeNotesRestoredListLoading();

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
      await page.getByRole("heading", { exact: true, name: target.heading }).waitFor();
      await page.getByRole("button", { name: target.buttonName }).waitFor();
      await page.locator('[data-shell="dashboard"]').waitFor();
      await page.locator(".app-header").waitFor();
      await page.locator(".app-header details.connection-details").waitFor();
      await page.locator(".surface-status").waitFor();

      if ((await page.locator(".app-nav").count()) > 0) {
        throw new Error(`${target.name} should not render fake section navigation`);
      }
      if ((await page.locator(".dashboard-content .connection-panel").count()) > 0) {
        throw new Error(`${target.name} should keep connection details out of the main content`);
      }

      const bodyBackgroundImage = await page.evaluate(
        () => getComputedStyle(document.body).backgroundImage,
      );
      if (bodyBackgroundImage !== "none") {
        throw new Error(
          `${target.name} should use a plain dashboard background, got ${bodyBackgroundImage}`,
        );
      }

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

async function smokeNotesRestoredListLoading(): Promise<void> {
  let resolveServerInfoRequest: (() => void) | null = null;
  const serverInfoRequest = new Promise<void>((resolve) => {
    resolveServerInfoRequest = resolve;
  });
  const certPath = join(repoRoot, "examples/notes/frontend/localhost.pem");
  const keyPath = join(repoRoot, "examples/notes/frontend/localhost-key.pem");
  const usesHttps = existsSync(certPath) && existsSync(keyPath);

  const headers = {
    "Access-Control-Allow-Headers": "authorization,content-type,x-tinycloud-request",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Origin": "*",
  };
  const backend = Bun.serve({
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return new Response(null, { headers, status: 204 });

      if (url.pathname === "/api/server-info") {
        resolveServerInfoRequest?.();
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return Response.json(
          {
            did: "did:key:z6Mksmoke",
            permissions: [
              {
                actions: ["read", "write"],
                path: "notes/*",
                service: "tinycloud.kv",
              },
            ],
            policyHash: "smoke-policy",
            status: "ok",
          },
          { headers },
        );
      }

      return Response.json({ error: "not_found", message: "Not found" }, { headers, status: 404 });
    },
    port: 0,
    ...(usesHttps && {
      tls: {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      },
    }),
  });
  const backendUrl = `${usesHttps ? "https" : "http"}://127.0.0.1:${backend.port}`;

  const proc = Bun.spawn(
    [process.execPath, "run", "dev", "--", "--host", "127.0.0.1", "--port", "6176"],
    {
      cwd: join(repoRoot, "examples/notes/frontend"),
      env: {
        ...process.env,
        VITE_BACKEND_URL: backendUrl,
      },
      stderr: "ignore",
      stdout: "ignore",
    },
  );

  try {
    await waitForTcp(6176);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.addInitScript(() => {
        localStorage.setItem(
          "tinycloud-notes:session",
          JSON.stringify({
            address: "0x0000000000000000000000000000000000000001",
            expiresAt: Date.now() + 60_000,
            token: "smoke-token",
          }),
        );
      });
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));

      await page.goto(`${usesHttps ? "https" : "http"}://127.0.0.1:6176`, {
        waitUntil: "domcontentloaded",
      });
      await Promise.race([
        serverInfoRequest,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for server info request")), 10_000),
        ),
      ]);

      await page.locator(".list-readiness").getByText("Preparing library").waitFor({
        timeout: 1_500,
      });
      if ((await page.locator(".note-list .empty-state").count()) > 0) {
        throw new Error("notes should not show an empty state while restored startup is loading");
      }
      if ((await page.locator(".editor textarea").count()) > 0) {
        throw new Error(
          "notes should not render the editor form while restored startup is loading",
        );
      }
      if (consoleErrors.length || pageErrors.length) {
        throw new Error(
          `notes restored loading browser errors:\n${[...consoleErrors, ...pageErrors].join("\n")}`,
        );
      }
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    proc.kill();
    await proc.exited.catch(() => undefined);
    backend.stop(true);
  }
}

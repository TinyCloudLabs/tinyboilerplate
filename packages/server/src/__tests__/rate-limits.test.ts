import { describe, expect, it } from "bun:test";
import express from "express";
import { applyRateLimiter, GLOBAL_LIMIT } from "../rate-limits.js";

const realFetch = globalThis.fetch;

function buildApp() {
  const app = express();
  applyRateLimiter(app);
  app.get("/api/probe", (_req, res) => res.json({ ok: true }));
  return app;
}

async function withServer<T>(app: express.Express, fn: (port: number) => Promise<T>): Promise<T> {
  const server = await new Promise<import("http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address() as { port: number };
  try {
    return await fn(port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("rate limiter (applyRateLimiter)", () => {
  it("configures one-hop proxy trust before registering IP-based limiters", () => {
    const app = express();
    applyRateLimiter(app);
    expect(app.get("trust proxy")).toBe(1);
  });

  it("distinct X-Forwarded-For IPs get distinct buckets", async () => {
    const app = buildApp();
    await withServer(app, async (port) => {
      // Exhaust the bucket for IP 1.1.1.1
      for (let i = 0; i < GLOBAL_LIMIT; i++) {
        const r = await realFetch(`http://localhost:${port}/api/probe`, {
          headers: { "X-Forwarded-For": "1.1.1.1" },
        });
        expect(r.status).toBe(200);
      }
      const over = await realFetch(`http://localhost:${port}/api/probe`, {
        headers: { "X-Forwarded-For": "1.1.1.1" },
      });
      expect(over.status).toBe(429);

      // A different IP must still have its own full bucket
      const other = await realFetch(`http://localhost:${port}/api/probe`, {
        headers: { "X-Forwarded-For": "2.2.2.2" },
      });
      expect(other.status).toBe(200);
    });
  });

  it("rate limits after the global limit is reached", async () => {
    const app = buildApp();
    await withServer(app, async (port) => {
      for (let i = 0; i < GLOBAL_LIMIT; i++) {
        const r = await realFetch(`http://localhost:${port}/api/probe`, {
          headers: { "X-Forwarded-For": "3.3.3.3" },
        });
        expect(r.status).toBe(200);
      }
      const over = await realFetch(`http://localhost:${port}/api/probe`, {
        headers: { "X-Forwarded-For": "3.3.3.3" },
      });
      expect(over.status).toBe(429);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { Server } from "http";
import { MANAGE_STORAGE_URL, STORAGE_FULL_COPY } from "@tinyboilerplate/core";
import { PROBE_KV_PREFIX } from "../manifest.js";
import { createProbeRouter } from "../routes/probe.js";
import { probeKey } from "../storage/probe.js";

function createMockKV(options: { parseJsonOnGet?: boolean } = {}) {
  const values = new Map<string, unknown>();
  const calls: Array<{ method: string; key?: string; value?: unknown }> = [];

  return {
    _values: values,
    _calls: calls,
    get: async (key: string) => {
      calls.push({ method: "get", key });
      const value = values.get(key);
      if (value === undefined) return { ok: false, error: { message: "not found" } };
      if (options.parseJsonOnGet && typeof value === "string") {
        try {
          return { ok: true, data: { data: JSON.parse(value) } };
        } catch {
          return { ok: true, data: { data: value } };
        }
      }
      return { ok: true, data: { data: value } };
    },
    put: async (key: string, value: unknown) => {
      calls.push({ method: "put", key, value });
      values.set(key, value);
      return { ok: true };
    },
    delete: async (key: string) => {
      calls.push({ method: "delete", key });
      values.delete(key);
      return { ok: true };
    },
  };
}

function createApp(access?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    _req.user = { address: "0xtest" };
    if (access) _req.delegatedAccess = access as any;
    next();
  });
  app.use("/api/probe", createProbeRouter());
  return app;
}

async function startServer(app: express.Express): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      resolve({ server, url: `http://localhost:${port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("probe routes", () => {
  let server: Server;
  let url: string;
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(async () => {
    kv = createMockKV();
    const started = await startServer(createApp({ kv }));
    server = started.server;
    url = started.url;
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it("requires active delegated access", async () => {
    const started = await startServer(createApp());
    try {
      const response = await fetch(`${started.url}/api/probe`);
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("no_delegation");
    } finally {
      await closeServer(started.server);
    }
  });

  it("writes, reads, and deletes a bounded KV probe value", async () => {
    expect(probeKey()).toBe(`${PROBE_KV_PREFIX}value`);

    const put = await fetch(`${url}/api/probe`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "delegated storage works" }),
    });
    expect(put.status).toBe(200);
    const written = (await put.json()).probe;
    expect(written.value).toBe("delegated storage works");
    expect(written.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(kv._values.has(probeKey())).toBe(true);

    const get = await fetch(`${url}/api/probe`);
    expect(get.status).toBe(200);
    expect((await get.json()).probe).toEqual(written);

    const del = await fetch(`${url}/api/probe`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect(kv._values.has(probeKey())).toBe(false);
  });

  it("reads the probe when TinyCloud returns parsed JSON from KV", async () => {
    const parsedKv = createMockKV({ parseJsonOnGet: true });
    const started = await startServer(createApp({ kv: parsedKv }));
    try {
      const put = await fetch(`${started.url}/api/probe`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "parsed KV works" }),
      });
      expect(put.status).toBe(200);
      const written = (await put.json()).probe;

      const get = await fetch(`${started.url}/api/probe`);
      expect(get.status).toBe(200);
      expect((await get.json()).probe).toEqual(written);
    } finally {
      await closeServer(started.server);
    }
  });

  it("treats TinyCloud no-content delete parse errors as a completed delete", async () => {
    kv.delete = async (key: string) => {
      kv._calls.push({ method: "delete", key });
      return { ok: false, error: { message: "Error parsing XML: no root element" } };
    };

    const response = await fetch(`${url}/api/probe`, { method: "DELETE" });

    expect(response.status).toBe(204);
    expect(kv._calls).toEqual([{ method: "delete", key: probeKey() }]);
  });

  it("rejects oversized probe values before touching KV", async () => {
    const response = await fetch(`${url}/api/probe`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(1025) }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("value_too_long");
    expect(kv._calls).toEqual([]);
  });

  it("keeps reads working and refuses writes with the storage code when storage is full", async () => {
    kv._values.set(
      probeKey(),
      JSON.stringify({ value: "kept", updatedAt: "2026-10-04T00:00:00Z" }),
    );
    kv.put = async (key: string, value: unknown) => {
      kv._calls.push({ method: "put", key, value });
      return {
        ok: false,
        error: {
          code: "STORAGE_QUOTA_EXCEEDED",
          message: "Storage quota exceeded. Used: 155744 bytes, Limit: 0 bytes",
        },
      };
    };

    const get = await fetch(`${url}/api/probe`);
    expect(get.status).toBe(200);
    expect((await get.json()).probe.value).toBe("kept");

    const put = await fetch(`${url}/api/probe`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "will not fit" }),
    });
    expect(put.status).toBe(402);
    expect(await put.json()).toEqual({
      error: "STORAGE_QUOTA_EXCEEDED",
      message: STORAGE_FULL_COPY.saveRejected,
      manageUrl: MANAGE_STORAGE_URL,
    });
  });

  it("keeps a typed STORAGE_LIMIT_REACHED even when the node text says quota exceeded", async () => {
    kv.put = async (key: string, value: unknown) => {
      kv._calls.push({ method: "put", key, value });
      return {
        ok: false,
        error: {
          code: "STORAGE_LIMIT_REACHED",
          message: "Storage quota exceeded. Used: 155744 bytes, Limit: 160000 bytes",
        },
      };
    };

    const put = await fetch(`${url}/api/probe`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "larger than what is left" }),
    });
    expect(put.status).toBe(413);
    expect(await put.json()).toEqual({
      error: "STORAGE_LIMIT_REACHED",
      message: STORAGE_FULL_COPY.saveTooLarge,
      manageUrl: MANAGE_STORAGE_URL,
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { Server } from "http";
import { NOTE_BODY_KV_PREFIX, NOTES_SQL_DATABASE_ID } from "../manifest.js";
import { createNotesRouter } from "../routes/notes.js";

function createMockKV() {
  const values = new Map<string, unknown>();
  const calls: Array<{ method: string; key?: string; value?: unknown; prefix?: string }> = [];

  return {
    _values: values,
    _calls: calls,
    get: async (key: string) => {
      calls.push({ method: "get", key });
      const value = values.get(key);
      if (value === undefined) return { ok: false, error: { message: "not found" } };
      return { ok: true, data: { data: value } };
    },
    put: async (key: string, value: unknown) => {
      calls.push({ method: "put", key, value });
      values.set(key, value);
      return { ok: true };
    },
    list: async ({ prefix }: { prefix: string }) => {
      calls.push({ method: "list", prefix });
      return {
        ok: true,
        data: { keys: [...values.keys()].filter((key) => key.startsWith(prefix)) },
      };
    },
    delete: async (key: string) => {
      calls.push({ method: "delete", key });
      values.delete(key);
      return { ok: true };
    },
  };
}

function createMockSQL() {
  const rows = new Map<string, Record<string, string>>();
  const calls: Array<{ method: string; db?: string; sql: string; params?: unknown[] }> = [];

  function service(db?: string) {
    return {
      db: (name: string) => service(name),
      execute: async (sql: string, params?: unknown[]) => {
        calls.push({ method: "execute", db, sql, params });
        const normalized = sql.trim().toUpperCase();
        if (normalized.startsWith("INSERT")) {
          rows.set(String(params?.[0]), {
            id: String(params?.[0]),
            title: String(params?.[1]),
            url: params?.[2] == null ? "" : String(params?.[2]),
            tags: String(params?.[3] ?? "[]"),
            body_key: String(params?.[4]),
            created_at: String(params?.[5]),
            updated_at: String(params?.[6]),
          });
        }
        if (normalized.startsWith("UPDATE")) {
          const id = String(params?.[5]);
          const row = rows.get(id);
          if (row) {
            row.title = String(params?.[0]);
            row.url = params?.[1] == null ? "" : String(params?.[1]);
            row.tags = String(params?.[2]);
            row.body_key = String(params?.[3]);
            row.updated_at = String(params?.[4]);
          }
        }
        if (normalized.startsWith("DELETE")) {
          rows.delete(String(params?.[0]));
        }
        return { ok: true, data: { changes: 1 } };
      },
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ method: "query", db, sql, params });
        const normalized = sql.trim().toUpperCase();
        const columns = ["id", "title", "url", "tags", "body_key", "created_at", "updated_at"];
        let found = [...rows.values()];
        if (normalized.includes("WHERE ID = ?")) {
          found = rows.get(String(params?.[0])) ? [rows.get(String(params?.[0]))!] : [];
        } else if (normalized.includes("LIKE")) {
          const needle = String(params?.[0]).replace(/%/g, "").toLowerCase();
          found = found.filter((row) =>
            [row.title, row.url, row.tags].some((value) => value.toLowerCase().includes(needle)),
          );
        }
        return {
          ok: true,
          data: {
            columns,
            rows: found.map((row) => columns.map((column) => row[column])),
            rowCount: found.length,
          },
        };
      },
    };
  }

  return { ...service(), _calls: calls, _rows: rows };
}

function createApp(access: unknown) {
  const app = express();
  app.use(express.json());
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    _req.user = { address: "0xtest" };
    _req.delegatedAccess = access as any;
    next();
  });
  app.use("/api/notes", createNotesRouter());
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

describe("Notes routes", () => {
  let server: Server;
  let url: string;
  let kv: ReturnType<typeof createMockKV>;
  let sql: ReturnType<typeof createMockSQL>;

  beforeEach(async () => {
    kv = createMockKV();
    sql = createMockSQL();
    const app = createApp({ kv, sql });
    const started = await startServer(app);
    server = started.server;
    url = started.url;
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it("creates metadata in the resolved SQL database and body in the resolved KV prefix", async () => {
    const response = await fetch(`${url}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Launch notes",
        url: "https://tinycloud.xyz",
        tags: "release, proof",
        body: "This is the first real example app.",
      }),
    });

    expect(response.status).toBe(201);
    const { note } = await response.json();

    expect(note.title).toBe("Launch notes");
    expect(note.tags).toEqual(["release", "proof"]);
    expect(note.body).toBe("This is the first real example app.");
    expect(note.bodyKey).toBe(`${NOTE_BODY_KV_PREFIX}${note.id}`);
    expect(kv._values.get(`${NOTE_BODY_KV_PREFIX}${note.id}`)).toBe(note.body);
    expect(sql._calls.some((call) => call.db === NOTES_SQL_DATABASE_ID)).toBe(true);
  });

  it("lists and searches notes with detail body loaded from KV", async () => {
    const create = async (title: string, tags: string, body: string) => {
      const response = await fetch(`${url}/api/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, tags, body }),
      });
      expect(response.status).toBe(201);
      return (await response.json()).note;
    };

    const alpha = await create("Alpha plan", "product", "Body A");
    await create("Beta log", "ops", "Body B");

    const list = await fetch(`${url}/api/notes?search=alpha`);
    expect(list.status).toBe(200);
    const body = await list.json();

    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].id).toBe(alpha.id);

    const detail = await fetch(`${url}/api/notes/${alpha.id}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).note.body).toBe("Body A");
  });

  it("skips orphan metadata rows whose body is missing from KV", async () => {
    sql._rows.set("orphan-note", {
      id: "orphan-note",
      title: "Orphan",
      url: "",
      tags: "[]",
      body_key: `${NOTE_BODY_KV_PREFIX}orphan-note`,
      created_at: "2026-05-20T00:00:00.000Z",
      updated_at: "2026-05-20T00:00:00.000Z",
    });

    const response = await fetch(`${url}/api/notes`);
    expect(response.status).toBe(200);
    expect((await response.json()).notes).toEqual([]);
  });

  it("does not leave metadata behind when note body creation fails", async () => {
    kv.put = async (key: string, value: unknown) => {
      kv._calls.push({ method: "put", key, value });
      return { ok: false, error: { message: "unauthorized" } };
    };

    const response = await fetch(`${url}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Partial", body: "Should not orphan metadata" }),
    });

    expect(response.status).toBe(500);
    expect(sql._rows.size).toBe(0);
  });

  it("updates and deletes a note across SQL metadata and KV body", async () => {
    const createResponse = await fetch(`${url}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Draft", tags: "draft", body: "Old body" }),
    });
    const created = (await createResponse.json()).note;

    const updateResponse = await fetch(`${url}/api/notes/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Edited", tags: "done, note", body: "New body" }),
    });
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()).note;
    expect(updated.title).toBe("Edited");
    expect(updated.tags).toEqual(["done", "note"]);
    expect(kv._values.get(`${NOTE_BODY_KV_PREFIX}${created.id}`)).toBe("New body");

    const deleteResponse = await fetch(`${url}/api/notes/${created.id}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(204);
    expect(kv._values.has(`${NOTE_BODY_KV_PREFIX}${created.id}`)).toBe(false);
    expect(sql._rows.has(created.id)).toBe(false);
  });

  it("preserves existing metadata and body when note body update fails", async () => {
    const createResponse = await fetch(`${url}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Draft", tags: "draft", body: "Old body" }),
    });
    const created = (await createResponse.json()).note;
    const bodyKey = `${NOTE_BODY_KV_PREFIX}${created.id}`;
    const originalRow = { ...sql._rows.get(created.id)! };

    kv.put = async (key: string, value: unknown) => {
      kv._calls.push({ method: "put", key, value });
      return { ok: false, error: { message: "write denied" } };
    };

    const updateResponse = await fetch(`${url}/api/notes/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Edited", tags: "done", body: "New body" }),
    });

    expect(updateResponse.status).toBe(500);
    expect(sql._rows.get(created.id)).toEqual(originalRow);
    expect(kv._values.get(bodyKey)).toBe("Old body");

    const detail = await fetch(`${url}/api/notes/${created.id}`);
    expect(detail.status).toBe(200);
    const { note } = await detail.json();
    expect(note.title).toBe("Draft");
    expect(note.tags).toEqual(["draft"]);
    expect(note.body).toBe("Old body");
  });

  it("keeps metadata when note body delete fails so deletion can be retried", async () => {
    const createResponse = await fetch(`${url}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Retry delete", tags: "cleanup", body: "Keep until deleted" }),
    });
    const created = (await createResponse.json()).note;
    const bodyKey = `${NOTE_BODY_KV_PREFIX}${created.id}`;

    kv.delete = async (key: string) => {
      kv._calls.push({ method: "delete", key });
      return { ok: false, error: { message: "delete denied" } };
    };

    const deleteResponse = await fetch(`${url}/api/notes/${created.id}`, { method: "DELETE" });

    expect(deleteResponse.status).toBe(500);
    expect(sql._rows.has(created.id)).toBe(true);
    expect(kv._values.get(bodyKey)).toBe("Keep until deleted");

    const detail = await fetch(`${url}/api/notes/${created.id}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).note.body).toBe("Keep until deleted");
  });

  it("rejects secret-like backend payloads", async () => {
    const response = await fetch(`${url}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Do not store",
        tags: "token",
        body: "OPENAI_API_KEY=sk-test",
      }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("secret_like_value");
  });
});

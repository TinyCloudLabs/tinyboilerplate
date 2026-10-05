import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { Server } from "http";
import { MANAGE_STORAGE_URL, STORAGE_FULL_COPY } from "@tinyboilerplate/core";
import { NOTE_BODY_KV_PREFIX, NOTES_SQL_DATABASE_ID } from "../manifest.js";
import { createNotesRouter } from "../routes/notes.js";

// What SDK 2.6.3 returns for the node's 402 on a full space: KV maps it to a
// typed code, SQL reports it as a network error carrying the node's text.
const NODE_402_TEXT = "Storage quota exceeded. Used: 155744 bytes, Limit: 0 bytes";
const KV_STORAGE_FULL = {
  code: "STORAGE_QUOTA_EXCEEDED",
  message: `Storage quota exceeded for key: ${NODE_402_TEXT}`,
};
const SQL_STORAGE_FULL = {
  code: "NETWORK_ERROR",
  message: `SQL execute failed: 402 - ${NODE_402_TEXT}`,
};

function createMockKV() {
  const values = new Map<string, unknown>();
  const calls: Array<{ method: string; key?: string; value?: unknown; prefix?: string }> = [];
  const state = { full: false };

  return {
    _values: values,
    _calls: calls,
    _state: state,
    get: async (key: string) => {
      calls.push({ method: "get", key });
      const value = values.get(key);
      if (value === undefined) return { ok: false, error: { message: "not found" } };
      return { ok: true, data: { data: value } };
    },
    put: async (key: string, value: unknown) => {
      calls.push({ method: "put", key, value });
      if (state.full) return { ok: false, error: KV_STORAGE_FULL };
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
    // The node never refuses a KV delete for storage: deleting frees space.
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
  // `full` models a node on the 1.17.x line, which refuses every non-read SQL
  // statement on a full space, including no-op DDL and DELETE.
  const state = { tableExists: false, full: false };
  const hasTable = () => state.tableExists || rows.size > 0;

  function service(db?: string) {
    return {
      db: (name: string) => service(name),
      execute: async (sql: string, params?: unknown[]) => {
        calls.push({ method: "execute", db, sql, params });
        if (state.full) return { ok: false, error: SQL_STORAGE_FULL };
        const normalized = sql.trim().toUpperCase();
        if (normalized.startsWith("CREATE TABLE")) {
          state.tableExists = true;
          return { ok: true, data: { changes: 0 } };
        }
        if (!hasTable()) return { ok: false, error: { message: "no such table: notes" } };
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
        if (normalized.includes("SQLITE_MASTER")) {
          return {
            ok: true,
            data: { columns: ["name"], rows: hasTable() ? [["notes"]] : [], rowCount: 0 },
          };
        }
        if (!hasTable()) return { ok: false, error: { message: "no such table: notes" } };
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

  return { ...service(), _calls: calls, _rows: rows, _state: state };
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

  const seedNote = (id: string, title: string, body: string) => {
    const bodyKey = `${NOTE_BODY_KV_PREFIX}${id}`;
    sql._rows.set(id, {
      id,
      title,
      url: "",
      tags: "[]",
      body_key: bodyKey,
      created_at: "2026-10-04T00:00:00.000Z",
      updated_at: "2026-10-04T00:00:00.000Z",
    });
    kv._values.set(bodyKey, body);
  };

  const writeCalls = () => [
    ...sql._calls.filter((call) => call.method === "execute"),
    ...kv._calls.filter((call) => call.method === "put" || call.method === "delete"),
  ];

  const post = (body: unknown) =>
    fetch(`${url}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("lists and opens notes on a full account without sending any write", async () => {
    seedNote("kept-note", "Kept", "Still readable");
    sql._state.full = true;
    kv._state.full = true;

    const list = await fetch(`${url}/api/notes`);
    expect(list.status).toBe(200);
    expect((await list.json()).notes.map((note: { id: string }) => note.id)).toEqual(["kept-note"]);

    const detail = await fetch(`${url}/api/notes/kept-note`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).note.body).toBe("Still readable");

    expect(writeCalls()).toEqual([]);
  });

  it("treats a missing schema as no notes instead of creating it on read", async () => {
    const list = await fetch(`${url}/api/notes`);
    expect(list.status).toBe(200);
    expect((await list.json()).notes).toEqual([]);

    const detail = await fetch(`${url}/api/notes/missing`);
    expect(detail.status).toBe(404);

    expect(writeCalls()).toEqual([]);
    expect(sql._state.tableExists).toBe(false);
  });

  it("creates the schema on the first save only when a read shows it missing", async () => {
    expect((await post({ title: "First" })).status).toBe(201);
    const creates = () => sql._calls.filter((call) => /CREATE TABLE/i.test(call.sql));
    expect(creates()).toHaveLength(1);

    // A fresh access object (new backend process) reads the schema again but
    // must not write it again.
    await closeServer(server);
    ({ server, url } = await startServer(createApp({ kv, sql })));
    expect((await post({ title: "Second" })).status).toBe(201);
    expect(creates()).toHaveLength(1);
  });

  it("refuses a save on a full account with the storage code and copy", async () => {
    seedNote("kept-note", "Kept", "Still readable");
    kv._state.full = true;
    sql._state.full = true;

    const response = await post({ title: "New", body: "Will not fit" });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: "STORAGE_QUOTA_EXCEEDED",
      message: STORAGE_FULL_COPY.saveRejected,
      manageUrl: MANAGE_STORAGE_URL,
    });
    expect([...sql._rows.keys()]).toEqual(["kept-note"]);
  });

  it("recognizes an older SDK's SQL 402 text and removes the stored body", async () => {
    seedNote("kept-note", "Kept", "Still readable");
    sql._state.full = true;

    const response = await post({ title: "New", body: "Body lands, metadata refused" });
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.error).toBe("STORAGE_QUOTA_EXCEEDED");
    expect(body.message).not.toMatch(/quota|Limit: 0|network/i);
    expect([...kv._values.keys()]).toEqual([`${NOTE_BODY_KV_PREFIX}kept-note`]);
  });

  it("answers 413 with the too-large copy when the write exceeds what is left", async () => {
    kv.put = async (key: string, value: unknown) => {
      kv._calls.push({ method: "put", key, value });
      return {
        ok: false,
        error: { code: "STORAGE_LIMIT_REACHED", message: "Write exceeds remaining storage" },
      };
    };

    const response = await post({ title: "Large", body: "x".repeat(2048) });
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error).toBe("STORAGE_LIMIT_REACHED");
    expect(body.message).toBe(STORAGE_FULL_COPY.saveTooLarge);
  });

  it("says exactly what was saved when only the note text was stored", async () => {
    seedNote("draft", "Draft", "Old body");
    sql._state.full = true;
    const realPut = kv.put;
    let puts = 0;
    // The new body fits; restoring the old one after metadata fails does not.
    kv.put = async (key: string, value: unknown) => {
      puts += 1;
      if (puts > 1) return { ok: false, error: KV_STORAGE_FULL };
      return realPut(key, value);
    };

    const response = await fetch(`${url}/api/notes/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Edited", body: "New body" }),
    });

    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.partial).toBe(true);
    expect(body.message).toBe(
      "The note text was saved, but its title, URL, and tags were not, because your TinyCloud storage is full.",
    );
    expect(kv._values.get(`${NOTE_BODY_KV_PREFIX}draft`)).toBe("New body");
    expect(sql._rows.get("draft")?.title).toBe("Draft");
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

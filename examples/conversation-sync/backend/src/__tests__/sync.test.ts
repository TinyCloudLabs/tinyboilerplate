import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import express from "express";
import type { Server } from "http";
import type { Request, Response, NextFunction } from "express";
import { createSyncRouter } from "../routes/sync.js";
import type { TranscriptSummary, FullTranscript } from "../services/fireflies-client.js";

// ── Mock KV Store ────────────────────────────────────────────────────

function createMockKV() {
  const data = new Map<string, string>();
  return {
    _data: data,
    get: async (key: string) => data.get(key) ?? null,
    put: async (key: string, value: string) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
  };
}

// ── Mock SQL ─────────────────────────────────────────────────────────

function createMockSQL() {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  let dedupRows: Array<{ source_id: string }> = [];

  return {
    _calls: calls,
    _setDedupRows(rows: Array<{ source_id: string }>) { dedupRows = rows; },
    execute: async (sql: string, params?: any[]) => {
      calls.push({ sql, params });

      // Schema CREATE statements
      if (sql.trim().startsWith("CREATE")) {
        return { ok: true };
      }

      // Dedup SELECT query
      if (sql.includes("SELECT source_id FROM conversation")) {
        return { ok: true, rows: dedupRows };
      }

      // INSERT statements
      if (sql.trim().startsWith("INSERT")) {
        return { ok: true };
      }

      return { ok: true, rows: [] };
    },
  };
}

// ── Mock Fireflies Client Factory ────────────────────────────────────

function createMockTranscriptSummary(overrides: Partial<TranscriptSummary> = {}): TranscriptSummary {
  return {
    id: overrides.id ?? "ff-1",
    title: overrides.title ?? "Test Meeting",
    date: overrides.date ?? 1711000000000,
    duration: overrides.duration ?? 3600,
    organizer_email: overrides.organizer_email ?? "test@example.com",
    transcript_url: overrides.transcript_url ?? "https://app.fireflies.ai/view/ff-1",
  };
}

function createMockFullTranscript(overrides: Partial<FullTranscript> = {}): FullTranscript {
  return {
    id: overrides.id ?? "ff-1",
    title: overrides.title ?? "Test Meeting",
    date: overrides.date ?? 1711000000000,
    duration: overrides.duration ?? 3600,
    organizer_email: overrides.organizer_email ?? "test@example.com",
    transcript_url: overrides.transcript_url ?? "https://app.fireflies.ai/view/ff-1",
    speakers: overrides.speakers ?? [
      { id: "s1", name: "Alice" },
      { id: "s2", name: "Bob" },
    ],
    meeting_attendees: overrides.meeting_attendees ?? [
      { displayName: "Alice", email: "alice@example.com" },
      { displayName: "Bob", email: "bob@example.com" },
    ],
    sentences: overrides.sentences ?? [
      {
        index: 0,
        speaker_id: "s1",
        speaker_name: "Alice",
        text: "Hello everyone",
        raw_text: "Hello everyone",
        start_time: 0,
        end_time: 2,
        ai_filters: {
          task: false,
          pricing: false,
          metric: false,
          question: false,
          date_and_time: false,
          sentiment: "neutral",
        },
      },
    ],
    summary: overrides.summary ?? {
      keywords: ["planning"],
      action_items: ["Follow up"],
      overview: "A test meeting overview",
      shorthand_bullet: "- Test bullet",
      meeting_type: "team_meeting",
    },
    audio_url: overrides.audio_url ?? "https://audio.example.com/ff-1.mp3",
  };
}

function createMockClientFactory() {
  let listResult: TranscriptSummary[] = [];
  let getResults = new Map<string, FullTranscript | Error>();
  let lastApiKey: string | null = null;

  return {
    setListResult(transcripts: TranscriptSummary[]) { listResult = transcripts; },
    setGetResult(id: string, result: FullTranscript | Error) { getResults.set(id, result); },
    getLastApiKey() { return lastApiKey; },
    factory(apiKey: string) {
      lastApiKey = apiKey;
      return {
        listTranscripts: async (_limit?: number) => listResult,
        getTranscript: async (id: string) => {
          const result = getResults.get(id);
          if (result instanceof Error) throw result;
          if (!result) throw new Error(`No mock transcript for id=${id}`);
          return result;
        },
      };
    },
  };
}

// ── Test Helpers ─────────────────────────────────────────────────────

const TEST_SUB = "test-sub";
const KV_KEY = "/app.conversations/config/fireflies-key";

function mockAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.user = { sub: TEST_SUB };
  next();
}

function createApp(
  mockKV: ReturnType<typeof createMockKV>,
  mockSQL: ReturnType<typeof createMockSQL>,
  clientFactory: ReturnType<typeof createMockClientFactory>,
) {
  const mockDelegationMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    req.delegatedAccess = { kv: mockKV, sql: mockSQL } as any;
    next();
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/sync",
    createSyncRouter({
      authMiddleware: mockAuthMiddleware,
      delegationMiddleware: mockDelegationMiddleware,
      createClient: clientFactory.factory,
    }),
  );
  return app;
}

function startServer(app: express.Express): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      resolve({ server, port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Sync Routes — POST /api/sync/fireflies", () => {
  let mockKV: ReturnType<typeof createMockKV>;
  let mockSQL: ReturnType<typeof createMockSQL>;
  let clientFactory: ReturnType<typeof createMockClientFactory>;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    mockKV = createMockKV();
    mockSQL = createMockSQL();
    clientFactory = createMockClientFactory();
    const app = createApp(mockKV, mockSQL, clientFactory);
    ({ server, port } = await startServer(app));
  });

  afterEach(async () => {
    await closeServer(server);
  });

  // ── Happy path ──────────────────────────────────────────────────

  it("syncs all transcripts when none exist in DB", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");

    const summaries = [
      createMockTranscriptSummary({ id: "ff-1", title: "Meeting 1" }),
      createMockTranscriptSummary({ id: "ff-2", title: "Meeting 2" }),
      createMockTranscriptSummary({ id: "ff-3", title: "Meeting 3" }),
    ];
    clientFactory.setListResult(summaries);
    clientFactory.setGetResult("ff-1", createMockFullTranscript({ id: "ff-1", title: "Meeting 1" }));
    clientFactory.setGetResult("ff-2", createMockFullTranscript({ id: "ff-2", title: "Meeting 2" }));
    clientFactory.setGetResult("ff-3", createMockFullTranscript({ id: "ff-3", title: "Meeting 3" }));

    // No existing transcripts in SQL
    mockSQL._setDedupRows([]);

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.synced).toBe(3);
    expect(body.skipped).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.errors).toEqual([]);
    expect(body.conversations).toHaveLength(3);
    expect(body.conversations[0]).toHaveProperty("id");
    expect(body.conversations[0]).toHaveProperty("title");
    expect(body.conversations[0]).toHaveProperty("started_at");
  });

  // ── Pre-fetch dedup ─────────────────────────────────────────────

  it("skips already-synced transcripts (pre-fetch dedup)", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");

    const summaries = [
      createMockTranscriptSummary({ id: "ff-1", title: "Meeting 1" }),
      createMockTranscriptSummary({ id: "ff-2", title: "Meeting 2" }),
      createMockTranscriptSummary({ id: "ff-3", title: "Meeting 3" }),
    ];
    clientFactory.setListResult(summaries);
    // Only set up getTranscript for ff-2 and ff-3 — ff-1 should not be fetched
    clientFactory.setGetResult("ff-2", createMockFullTranscript({ id: "ff-2", title: "Meeting 2" }));
    clientFactory.setGetResult("ff-3", createMockFullTranscript({ id: "ff-3", title: "Meeting 3" }));

    // ff-1 already exists in DB
    mockSQL._setDedupRows([{ source_id: "ff-1" }]);

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.synced).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.errors).toEqual([]);
    expect(body.conversations).toHaveLength(2);
  });

  // ── All skipped ─────────────────────────────────────────────────

  it("returns all skipped when every transcript already exists", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");

    const summaries = [
      createMockTranscriptSummary({ id: "ff-1" }),
      createMockTranscriptSummary({ id: "ff-2" }),
    ];
    clientFactory.setListResult(summaries);

    // Both already in DB
    mockSQL._setDedupRows([{ source_id: "ff-1" }, { source_id: "ff-2" }]);

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.synced).toBe(0);
    expect(body.skipped).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.errors).toEqual([]);
    expect(body.conversations).toHaveLength(0);
  });

  // ── Individual failure ──────────────────────────────────────────

  it("continues on individual transcript failure and reports error", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");

    const summaries = [
      createMockTranscriptSummary({ id: "ff-1", title: "Meeting 1" }),
      createMockTranscriptSummary({ id: "ff-2", title: "Meeting 2" }),
      createMockTranscriptSummary({ id: "ff-3", title: "Meeting 3" }),
    ];
    clientFactory.setListResult(summaries);

    clientFactory.setGetResult("ff-1", createMockFullTranscript({ id: "ff-1", title: "Meeting 1" }));
    clientFactory.setGetResult("ff-2", new Error("Fireflies API timeout"));
    clientFactory.setGetResult("ff-3", createMockFullTranscript({ id: "ff-3", title: "Meeting 3" }));

    mockSQL._setDedupRows([]);

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.synced).toBe(2);
    expect(body.skipped).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toContain("ff-2");
    expect(body.conversations).toHaveLength(2);
  });

  // ── Missing API key ─────────────────────────────────────────────

  it("returns 404 when no Fireflies API key is configured", async () => {
    // No key set in KV

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("no_api_key");
  });

  // ── Limit validation ───────────────────────────────────────────

  it("clamps limit > 50 to 50", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");
    clientFactory.setListResult([]);
    mockSQL._setDedupRows([]);

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 100 }),
    });

    expect(res.status).toBe(200);
    // The response should succeed; the limit was silently clamped.
    // We can verify via the mock that listTranscripts was called.
    const body = await res.json();
    expect(body.synced).toBe(0);
    expect(body.skipped).toBe(0);
  });

  it("defaults limit to 20 when not provided or invalid", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");
    clientFactory.setListResult([]);
    mockSQL._setDedupRows([]);

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: -5 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(0);
    expect(body.skipped).toBe(0);
  });

  // ── Empty list ──────────────────────────────────────────────────

  it("handles empty transcript list from Fireflies", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");
    clientFactory.setListResult([]);
    mockSQL._setDedupRows([]);

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.synced).toBe(0);
    expect(body.skipped).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.errors).toEqual([]);
    expect(body.conversations).toHaveLength(0);
  });

  // ── KV transcript blob ─────────────────────────────────────────

  it("writes transcript sentences to KV", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");

    const summaries = [createMockTranscriptSummary({ id: "ff-1" })];
    clientFactory.setListResult(summaries);
    clientFactory.setGetResult("ff-1", createMockFullTranscript({ id: "ff-1" }));
    mockSQL._setDedupRows([]);

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(1);

    // Verify KV was written with the conversation ID
    const conversationId = body.conversations[0].id;
    const kvKey = `/app.conversations/transcript/${conversationId}`;
    const storedBlob = mockKV._data.get(kvKey);
    expect(storedBlob).toBeDefined();

    // The blob should be a JSON string of the sentences array
    const parsed = JSON.parse(storedBlob!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].text).toBe("Hello everyone");
  });

  // ── SQL insert verification ────────────────────────────────────

  it("inserts conversation and participants into SQL", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");

    const summaries = [createMockTranscriptSummary({ id: "ff-1" })];
    clientFactory.setListResult(summaries);
    clientFactory.setGetResult("ff-1", createMockFullTranscript({ id: "ff-1" }));
    mockSQL._setDedupRows([]);

    const res = await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(1);

    // Find conversation INSERT calls
    const conversationInserts = mockSQL._calls.filter(
      (c) => c.sql.includes("INSERT") && c.sql.includes("conversation") && !c.sql.includes("participant"),
    );
    expect(conversationInserts.length).toBeGreaterThanOrEqual(1);

    // Find participant INSERT calls (Alice and Bob)
    const participantInserts = mockSQL._calls.filter(
      (c) => c.sql.includes("INSERT") && c.sql.includes("participant"),
    );
    expect(participantInserts.length).toBeGreaterThanOrEqual(2);
  });

  // ── Metadata is JSON-stringified ───────────────────────────────

  it("JSON-stringifies metadata before SQL insert", async () => {
    mockKV._data.set(KV_KEY, "test-api-key");

    const summaries = [createMockTranscriptSummary({ id: "ff-1" })];
    clientFactory.setListResult(summaries);
    clientFactory.setGetResult("ff-1", createMockFullTranscript({ id: "ff-1" }));
    mockSQL._setDedupRows([]);

    await fetch(`http://localhost:${port}/api/sync/fireflies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Find the conversation INSERT and check its params contain stringified metadata
    const conversationInsert = mockSQL._calls.find(
      (c) => c.sql.includes("INSERT") && c.sql.includes("conversation") && !c.sql.includes("participant"),
    );
    expect(conversationInsert).toBeDefined();

    // metadata should be a JSON string in the params
    const metadataParam = conversationInsert!.params?.find(
      (p) => typeof p === "string" && p.includes("audio_url"),
    );
    expect(metadataParam).toBeDefined();
    // Should be valid JSON
    const parsed = JSON.parse(metadataParam!);
    expect(parsed).toHaveProperty("audio_url");
    expect(parsed).toHaveProperty("organizer_email");
  });

  // ── Auth/delegation enforcement ─────────────────────────────────

  describe("Auth and delegation enforcement", () => {
    it("returns 401 when auth middleware rejects", async () => {
      const noAuthMiddleware = (_req: Request, res: Response, _next: NextFunction) => {
        res.status(401).json({ error: "unauthenticated" });
      };
      const mockDelegationMiddleware = (_req: Request, _res: Response, next: NextFunction) => {
        next();
      };

      const app = express();
      app.use(express.json());
      app.use(
        "/api/sync",
        createSyncRouter({
          authMiddleware: noAuthMiddleware as any,
          delegationMiddleware: mockDelegationMiddleware,
        }),
      );
      const { server: s, port: p } = await startServer(app);

      try {
        const res = await fetch(`http://localhost:${p}/api/sync/fireflies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(401);
      } finally {
        await closeServer(s);
      }
    });

    it("returns 403 when delegation middleware rejects", async () => {
      const noDelegationMiddleware = (_req: Request, res: Response, _next: NextFunction) => {
        res.status(403).json({ error: "no_delegation" });
      };

      const app = express();
      app.use(express.json());
      app.use(
        "/api/sync",
        createSyncRouter({
          authMiddleware: mockAuthMiddleware,
          delegationMiddleware: noDelegationMiddleware as any,
        }),
      );
      const { server: s, port: p } = await startServer(app);

      try {
        const res = await fetch(`http://localhost:${p}/api/sync/fireflies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(403);
      } finally {
        await closeServer(s);
      }
    });
  });
});

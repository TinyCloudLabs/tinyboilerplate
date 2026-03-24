import { describe, it, expect, beforeEach, mock } from "bun:test";

// ── Mock DelegatedAccess ─────────────────────────────────────────────

function createMockAccess() {
  return {
    sql: {
      execute: mock(async (_sql: string) => ({ ok: true })),
      query: mock(async () => ({ ok: true, rows: [], columns: [] })),
    },
    kv: {},
  } as any;
}

// ── Tests ────────────────────────────────────────────────────────────

import { ensureSchema, DATABASE_NAME } from "../schema.js";

describe("schema", () => {
  describe("DATABASE_NAME", () => {
    it("exports 'conversations' as the database name", () => {
      expect(DATABASE_NAME).toBe("conversations");
    });
  });

  describe("ensureSchema()", () => {
    let access: ReturnType<typeof createMockAccess>;

    beforeEach(() => {
      access = createMockAccess();
    });

    it("executes CREATE TABLE for conversation table", async () => {
      await ensureSchema(access);

      const calls = access.sql.execute.mock.calls;
      const allSql = calls.map((c: any) => c[0]).join("\n");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS conversation");
      expect(allSql).toContain("UNIQUE(source, source_id)");
    });

    it("executes CREATE TABLE for participant table", async () => {
      await ensureSchema(access);

      const calls = access.sql.execute.mock.calls;
      const allSql = calls.map((c: any) => c[0]).join("\n");
      expect(allSql).toContain("CREATE TABLE IF NOT EXISTS participant");
      expect(allSql).toContain("REFERENCES conversation(id)");
    });

    it("creates all 4 indexes", async () => {
      await ensureSchema(access);

      const calls = access.sql.execute.mock.calls;
      const allSql = calls.map((c: any) => c[0]).join("\n");
      expect(allSql).toContain("idx_convo_source");
      expect(allSql).toContain("idx_convo_started");
      expect(allSql).toContain("idx_participant_convo");
      expect(allSql).toContain("idx_participant_email");
    });

    it("no-ops on subsequent calls with the same access", async () => {
      await ensureSchema(access);
      const firstCallCount = access.sql.execute.mock.calls.length;

      await ensureSchema(access);
      expect(access.sql.execute.mock.calls.length).toBe(firstCallCount);
    });

    it("runs schema again for a different access object", async () => {
      await ensureSchema(access);

      const access2 = createMockAccess();
      await ensureSchema(access2);

      expect(access2.sql.execute.mock.calls.length).toBeGreaterThan(0);
    });

    it("throws when sql.execute returns ok: false", async () => {
      access.sql.execute.mockImplementation(async () => ({
        ok: false,
        error: { message: "DB unavailable" },
      }));

      expect(ensureSchema(access)).rejects.toThrow("Failed to initialize conversations schema");
    });
  });
});

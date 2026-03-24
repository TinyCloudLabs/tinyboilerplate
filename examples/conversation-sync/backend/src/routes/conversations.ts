import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
<<<<<<< HEAD
import { ensureSchema } from "../schema.js";
=======
import { ensureSchema, DATABASE_NAME } from "../schema.js";
>>>>>>> 0638c1c (TC-1304: Add GET /api/conversations and GET /api/conversations/:id read endpoints)

// ── Types ────────────────────────────────────────────────────────────

interface ConversationsRoutesConfig {
  authMiddleware: RequestHandler;
  delegationMiddleware: RequestHandler;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const DEFAULT_OFFSET = 0;

<<<<<<< HEAD
// ── Helpers ─────────────────────────────────────────────────────────

/**
 * TinyCloud SQL returns rows as arrays, not objects.
 * Map each row array to a keyed object using the columns list.
 */
function rowToObject(row: unknown[], columns: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  columns.forEach((col, i) => {
    obj[col] = row[i];
  });
  return obj;
}

function rowsToObjects(rows: unknown[][], columns: string[]): Record<string, unknown>[] {
  return rows.map((row) => rowToObject(row, columns));
}

=======
>>>>>>> 0638c1c (TC-1304: Add GET /api/conversations and GET /api/conversations/:id read endpoints)
// ── Conversations Routes ─────────────────────────────────────────────

export function createConversationsRouter(config: ConversationsRoutesConfig) {
  const { authMiddleware, delegationMiddleware } = config;
  const router = Router();

  router.use(authMiddleware);
  router.use(delegationMiddleware);

  // ── GET / — list conversations, newest first ──
  router.get("/", async (req: Request, res: Response) => {
    const access = req.delegatedAccess!;

    const limit = Math.max(1, parseInt(req.query.limit as string, 10) || DEFAULT_LIMIT);
    const offset = Math.max(0, parseInt(req.query.offset as string, 10) || DEFAULT_OFFSET);

    try {
      await ensureSchema(access);

      // Total count
<<<<<<< HEAD
      const countResult = await access.sql.query(`SELECT COUNT(*) AS total FROM conversation`);
      let total = 0;
      if (countResult.ok && countResult.data.rows?.[0]) {
        const countRow = rowToObject(
          countResult.data.rows[0] as unknown[],
          countResult.data.columns,
        );
        total = Number(countRow.total) || 0;
      }

      // Paginated list with participant_count subquery
      const listResult = await access.sql.query(
=======
      const countResult = await access.sql.execute(
        `SELECT COUNT(*) AS total FROM conversation`,
      );
      const total = countResult.ok && countResult.rows?.[0]
        ? (countResult.rows[0] as any).total
        : 0;

      // Paginated list with participant_count subquery
      const listResult = await access.sql.execute(
>>>>>>> 0638c1c (TC-1304: Add GET /api/conversations and GET /api/conversations/:id read endpoints)
        `SELECT c.id, c.title, c.source, c.source_url, c.started_at, c.duration_secs, c.summary, c.created_at,
           (SELECT COUNT(*) FROM participant p WHERE p.conversation_id = c.id) AS participant_count
         FROM conversation c
         ORDER BY c.started_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset],
      );

<<<<<<< HEAD
      const conversations = listResult.ok
        ? rowsToObjects(listResult.data.rows as unknown[][], listResult.data.columns)
        : [];
=======
      const conversations = listResult.ok ? (listResult.rows ?? []) : [];
>>>>>>> 0638c1c (TC-1304: Add GET /api/conversations and GET /api/conversations/:id read endpoints)

      res.json({ conversations, total });
    } catch (err) {
      console.error("[conversations] list failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "list_failed", message });
    }
  });

  // ── GET /:id — single conversation with participants + transcript ──
  router.get("/:id", async (req: Request, res: Response) => {
    const access = req.delegatedAccess!;
    const { id } = req.params;

    try {
      await ensureSchema(access);

      // Fetch conversation
<<<<<<< HEAD
      const convoResult = await access.sql.query(
=======
      const convoResult = await access.sql.execute(
>>>>>>> 0638c1c (TC-1304: Add GET /api/conversations and GET /api/conversations/:id read endpoints)
        `SELECT id, title, source, source_id, source_url, started_at, ended_at, duration_secs, summary, metadata, created_at, updated_at
         FROM conversation WHERE id = ?`,
        [id],
      );

<<<<<<< HEAD
      if (!convoResult.ok || !convoResult.data.rows?.length) {
=======
      const row = convoResult.ok && convoResult.rows?.[0]
        ? (convoResult.rows[0] as any)
        : null;

      if (!row) {
>>>>>>> 0638c1c (TC-1304: Add GET /api/conversations and GET /api/conversations/:id read endpoints)
        res.status(404).json({ error: "not_found", message: `Conversation ${id} not found` });
        return;
      }

<<<<<<< HEAD
      const row = rowToObject(convoResult.data.rows[0] as unknown[], convoResult.data.columns);

      // Parse metadata from JSON string
      let metadata: Record<string, unknown> = {};
      try {
        metadata = row.metadata ? JSON.parse(String(row.metadata)) : {};
=======
      // Parse metadata from JSON string
      let metadata: Record<string, unknown> = {};
      try {
        metadata = row.metadata ? JSON.parse(row.metadata) : {};
>>>>>>> 0638c1c (TC-1304: Add GET /api/conversations and GET /api/conversations/:id read endpoints)
      } catch {
        metadata = {};
      }

      const conversation = { ...row, metadata };

      // Fetch participants
<<<<<<< HEAD
      const participantsResult = await access.sql.query(
        `SELECT id, name, email, speaker_label FROM participant WHERE conversation_id = ?`,
        [id],
      );
      const participants = participantsResult.ok
        ? rowsToObjects(
            participantsResult.data.rows as unknown[][],
            participantsResult.data.columns,
          )
        : [];

      // Load transcript blob from KV
      const kvKey = `/app.conversations/transcript/${id}`;
      console.log(`[conversations] Loading transcript from KV: ${kvKey}`);
      const kvResult = await access.kv.get(kvKey);
      console.log(
        `[conversations] KV result ok=${kvResult.ok}, hasData=${kvResult.ok && kvResult.data?.data != null}, type=${kvResult.ok ? typeof kvResult.data?.data : "n/a"}`,
      );
      let transcript: unknown = null;
      if (kvResult.ok && kvResult.data.data) {
        const raw = kvResult.data.data;
        // KV may return already-parsed object or a JSON string
        if (typeof raw === "string") {
          try {
            transcript = JSON.parse(raw);
          } catch {
            transcript = null;
          }
        } else {
          transcript = raw;
=======
      const participantsResult = await access.sql.execute(
        `SELECT id, name, email, speaker_label FROM participant WHERE conversation_id = ?`,
        [id],
      );
      const participants = participantsResult.ok ? (participantsResult.rows ?? []) : [];

      // Load transcript blob from KV
      const kvKey = `/app.conversations/transcript/${id}`;
      const transcriptBlob = await access.kv.get(kvKey);
      let transcript: unknown = null;
      if (transcriptBlob) {
        try {
          transcript = JSON.parse(transcriptBlob);
        } catch {
          transcript = null;
>>>>>>> 0638c1c (TC-1304: Add GET /api/conversations and GET /api/conversations/:id read endpoints)
        }
      }

      res.json({ conversation, participants, transcript });
    } catch (err) {
      console.error("[conversations] detail failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "detail_failed", message });
    }
  });

  return router;
}

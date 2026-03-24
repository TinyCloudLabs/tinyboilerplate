import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
import { ensureSchema, DATABASE_NAME } from "../schema.js";

// ── Types ────────────────────────────────────────────────────────────

interface ConversationsRoutesConfig {
  authMiddleware: RequestHandler;
  delegationMiddleware: RequestHandler;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const DEFAULT_OFFSET = 0;

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
      const countResult = await access.sql.execute(
        `SELECT COUNT(*) AS total FROM conversation`,
      );
      const total = countResult.ok && countResult.rows?.[0]
        ? (countResult.rows[0] as any).total
        : 0;

      // Paginated list with participant_count subquery
      const listResult = await access.sql.execute(
        `SELECT c.id, c.title, c.source, c.source_url, c.started_at, c.duration_secs, c.summary, c.created_at,
           (SELECT COUNT(*) FROM participant p WHERE p.conversation_id = c.id) AS participant_count
         FROM conversation c
         ORDER BY c.started_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset],
      );

      const conversations = listResult.ok ? (listResult.rows ?? []) : [];

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
      const convoResult = await access.sql.execute(
        `SELECT id, title, source, source_id, source_url, started_at, ended_at, duration_secs, summary, metadata, created_at, updated_at
         FROM conversation WHERE id = ?`,
        [id],
      );

      const row = convoResult.ok && convoResult.rows?.[0]
        ? (convoResult.rows[0] as any)
        : null;

      if (!row) {
        res.status(404).json({ error: "not_found", message: `Conversation ${id} not found` });
        return;
      }

      // Parse metadata from JSON string
      let metadata: Record<string, unknown> = {};
      try {
        metadata = row.metadata ? JSON.parse(row.metadata) : {};
      } catch {
        metadata = {};
      }

      const conversation = { ...row, metadata };

      // Fetch participants
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

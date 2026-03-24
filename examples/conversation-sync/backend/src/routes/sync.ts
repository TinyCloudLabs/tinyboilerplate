import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
import { FirefliesClient } from "../services/fireflies-client.js";
import { normalizeFireflies } from "../adapters/fireflies.js";
import { ensureSchema } from "../schema.js";

// ── Types ────────────────────────────────────────────────────────────

interface SyncRoutesConfig {
  authMiddleware: RequestHandler;
  delegationMiddleware: RequestHandler;
  /** Optional factory for testing — defaults to creating a real FirefliesClient */
  createClient?: (apiKey: string) => Pick<FirefliesClient, "listTranscripts" | "getTranscript">;
}

// ── Constants ────────────────────────────────────────────────────────

const FIREFLIES_KEY_PATH = "/app.conversations/config/fireflies-key";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// ── Sync Routes ──────────────────────────────────────────────────────

export function createSyncRouter(config: SyncRoutesConfig) {
  const { authMiddleware, delegationMiddleware } = config;
  const makeClient = config.createClient ?? ((key: string) => new FirefliesClient(key));
  const router = Router();

  // All sync routes require auth + delegation
  router.use(authMiddleware);
  router.use(delegationMiddleware);

  // ── POST /api/sync/fireflies — full sync with pre-fetch dedup ──
  router.post("/fireflies", async (req: Request, res: Response) => {
    const access = req.delegatedAccess!;

    // 1. Read Fireflies API key from KV
    const apiKey = await access.kv.get(FIREFLIES_KEY_PATH);
    if (!apiKey) {
      res.status(404).json({
        error: "no_api_key",
        message: "No Fireflies API key configured. Store one first via PUT /api/config/fireflies-key.",
      });
      return;
    }

    // 2. Validate and clamp limit
    let limit = DEFAULT_LIMIT;
    if (req.body && typeof req.body.limit === "number") {
      limit = req.body.limit;
    }
    if (limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    try {
      // 3. Ensure schema exists
      await ensureSchema(access);

      const client = makeClient(apiKey);

      // 4. List transcripts (lightweight)
      const summaries = await client.listTranscripts(limit);

      if (summaries.length === 0) {
        res.json({
          synced: 0,
          skipped: 0,
          failed: 0,
          errors: [],
          conversations: [],
        });
        return;
      }

      // 5. Collect source_ids and query SQL for existing ones
      const sourceIds = summaries.map((s) => s.id);
      const placeholders = sourceIds.map(() => "?").join(", ");
      const dedupQuery = `SELECT source_id FROM conversation WHERE source = 'fireflies' AND source_id IN (${placeholders})`;
      const dedupResult = await access.sql.execute(dedupQuery, sourceIds);

      const existingIds = new Set<string>();
      if (dedupResult.ok && dedupResult.rows) {
        for (const row of dedupResult.rows) {
          existingIds.add((row as any).source_id);
        }
      }

      // 6. Filter to only new source_ids
      const newSummaries = summaries.filter((s) => !existingIds.has(s.id));
      const skipped = summaries.length - newSummaries.length;

      // 7. Fetch details, normalize, and insert each new transcript
      let synced = 0;
      let failed = 0;
      const errors: string[] = [];
      const conversations: Array<{ id: string; title: string; started_at: string }> = [];

      for (const summary of newSummaries) {
        try {
          // Fetch full transcript
          const fullTranscript = await client.getTranscript(summary.id);

          // Normalize
          const normalized = normalizeFireflies(fullTranscript);

          // INSERT conversation
          const now = new Date().toISOString();
          const metadataJson = JSON.stringify(normalized.conversation.metadata);

          await access.sql.execute(
            `INSERT OR IGNORE INTO conversation (id, title, source, source_id, source_url, started_at, ended_at, duration_secs, summary, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              normalized.conversation.id,
              normalized.conversation.title,
              normalized.conversation.source,
              normalized.conversation.source_id,
              normalized.conversation.source_url,
              normalized.conversation.started_at,
              normalized.conversation.ended_at,
              normalized.conversation.duration_secs,
              normalized.conversation.summary,
              metadataJson,
              now,
              now,
            ],
          );

          // INSERT participants
          for (const participant of normalized.participants) {
            await access.sql.execute(
              `INSERT OR IGNORE INTO participant (id, conversation_id, name, email, speaker_label) VALUES (?, ?, ?, ?, ?)`,
              [
                participant.id,
                normalized.conversation.id,
                participant.name,
                participant.email,
                participant.speaker_label,
              ],
            );
          }

          // Write transcript sentences blob to KV
          const kvKey = `/app.conversations/transcript/${normalized.conversation.id}`;
          await access.kv.put(kvKey, JSON.stringify(normalized.transcript));

          synced++;
          conversations.push({
            id: normalized.conversation.id,
            title: normalized.conversation.title ?? "",
            started_at: normalized.conversation.started_at ?? "",
          });
        } catch (err) {
          failed++;
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`${summary.id}: ${message}`);
        }
      }

      res.json({
        synced,
        skipped,
        failed,
        errors,
        conversations,
      });
    } catch (err) {
      console.error("[sync] fireflies sync failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: "sync_failed",
        message: `Sync failed: ${message}`,
      });
    }
  });

  return router;
}

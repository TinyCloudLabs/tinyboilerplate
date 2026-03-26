import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
import { FirefliesClient } from "../services/fireflies-client.js";
import { ensureSchema } from "../schema.js";
import { syncSingleTranscript } from "../services/sync-pipeline.js";

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
    const keyResult = await access.kv.get(FIREFLIES_KEY_PATH);
    const apiKey = keyResult.ok && keyResult.data.data != null ? String(keyResult.data.data) : null;
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
      console.log(`[sync] Fireflies returned ${summaries.length} transcripts:`, summaries.map(s => ({ id: s.id, title: s.title })));

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
      const dedupResult = await access.sql.query(dedupQuery, sourceIds);

      const existingIds = new Set<string>();
      if (dedupResult.ok && dedupResult.data.rows) {
        // TinyCloud SQL rows are arrays — source_id is the only selected column (index 0)
        for (const row of dedupResult.data.rows) {
          const val = Array.isArray(row) ? row[0] : (row as any).source_id;
          if (val) existingIds.add(String(val));
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
        const result = await syncSingleTranscript(summary.id, access, client);
        if (result.status === "created") {
          synced++;
          conversations.push({
            id: result.conversationId!,
            title: result.title ?? summary.title ?? "",
            started_at: result.startedAt ?? "",
          });
        } else if (result.status === "error") {
          failed++;
          errors.push(`${summary.id}: ${result.error}`);
        }
        // 'skipped' shouldn't happen here due to batch dedup, but handle gracefully
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

  // ── DELETE /api/sync/conversations — clear all data for re-sync ──
  router.delete("/conversations", async (req: Request, res: Response) => {
    const access = req.delegatedAccess!;
    try {
      await ensureSchema(access);
      await access.sql.execute(`DELETE FROM participant`);
      await access.sql.execute(`DELETE FROM conversation`);
      res.json({ ok: true, message: "All conversations cleared. Re-sync to repopulate." });
    } catch (err) {
      console.error("[sync] clear failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "clear_failed", message });
    }
  });

  return router;
}

import { Router, raw as expressRaw } from "express";
import type { Request, Response, RequestHandler } from "express";
import type { DelegatedAccess } from "@tinyboilerplate/server";
import { verifyFirefliesSignature } from "../services/webhook-verify.js";
import { syncSingleTranscript, type SyncSingleResult } from "../services/sync-pipeline.js";
import { FirefliesClient } from "../services/fireflies-client.js";
import { ensureSchema } from "../schema.js";

// ── Types ────────────────────────────────────────────────────────────

interface BackendKV {
  get(key: string): Promise<{ ok: boolean; data: { data: string | null } }>;
  put(key: string, value: string): Promise<{ ok: boolean }>;
}

interface WebhookRoutesConfig {
  backendKV: BackendKV;
  tryGetDelegatedAccess: () => Promise<DelegatedAccess | null>;
  /** Auth middleware for pending endpoints (not needed for POST webhook) */
  authMiddleware?: RequestHandler;
  /** Delegation middleware for pending endpoints */
  delegationMiddleware?: RequestHandler;
  /** Override for testing */
  syncFn?: (meetingId: string, access: DelegatedAccess, client: Pick<FirefliesClient, "getTranscript">) => Promise<SyncSingleResult>;
  /** Override for testing */
  createClient?: (apiKey: string) => Pick<FirefliesClient, "getTranscript">;
}

// ── Constants ────────────────────────────────────────────────────────

const SECRET_KV_KEY = "/app.webhooks/config/fireflies-secret";
const PENDING_KV_KEY = "/app.webhooks/pending/fireflies";
const FIREFLIES_KEY_PATH = "/app.conversations/config/fireflies-key";

// ── Webhook Routes ──────────────────────────────────────────────────

export function createWebhookRouter(config: WebhookRoutesConfig) {
  const { backendKV, tryGetDelegatedAccess } = config;
  const doSync = config.syncFn ?? syncSingleTranscript;
  const makeClient = config.createClient ?? ((key: string) => new FirefliesClient(key));

  const router = Router();

  // POST /fireflies — public endpoint, HMAC-verified
  router.post(
    "/fireflies",
    expressRaw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");

      // 1. Read webhook secret from backend KV
      const secretResult = await backendKV.get(SECRET_KV_KEY);
      const secret = secretResult.ok && secretResult.data.data ? secretResult.data.data : null;

      if (!secret) {
        res.status(401).json({
          error: "no_webhook_secret",
          message: "Webhook secret not configured",
        });
        return;
      }

      // 2. Verify HMAC signature
      const signatureHeader = req.headers["x-hub-signature"] as string | undefined;
      if (!signatureHeader || !verifyFirefliesSignature(rawBody, signatureHeader, secret)) {
        res.status(401).json({
          error: "invalid_signature",
          message: "Invalid or missing HMAC signature",
        });
        return;
      }

      // 3. Parse JSON body
      let payload: { meetingId?: string; eventType?: string };
      try {
        payload = JSON.parse(rawBody.toString());
      } catch {
        res.status(400).json({
          error: "invalid_json",
          message: "Request body is not valid JSON",
        });
        return;
      }

      // 4. Ignore non-transcription events (return 200 to prevent retries)
      if (payload.eventType !== "Transcription completed") {
        res.json({ status: "ignored", eventType: payload.eventType });
        return;
      }

      // 5. Validate meetingId
      if (!payload.meetingId) {
        res.status(400).json({
          error: "missing_meeting_id",
          message: "meetingId is required for transcription events",
        });
        return;
      }

      const { meetingId } = payload;

      // 6. Check delegation
      try {
        const access = await tryGetDelegatedAccess();

        if (!access) {
          await storePending(backendKV, meetingId);
          res.json({ status: "pending", reason: "delegation_expired" });
          return;
        }

        // 7. Read Fireflies API key from user's KV
        const apiKeyResult = await access.kv.get(FIREFLIES_KEY_PATH);
        const apiKey = apiKeyResult.ok && apiKeyResult.data.data
          ? String(apiKeyResult.data.data)
          : null;

        if (!apiKey) {
          await storePending(backendKV, meetingId);
          res.json({ status: "pending", reason: "no_api_key" });
          return;
        }

        // 8. Sync transcript
        await ensureSchema(access);
        const client = makeClient(apiKey);
        const result = await doSync(meetingId, access, client);

        if (result.status === "error") {
          res.status(500).json({ status: "error", error: result.error });
          return;
        }

        res.json({
          status: "processed",
          meetingId: result.meetingId,
          conversationId: result.conversationId,
          title: result.title,
        });
      } catch (err) {
        console.error("[webhook] processing failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ status: "error", error: message });
      }
    },
  );

  // ── Pending queue endpoints (require auth + delegation) ──────────

  if (config.authMiddleware && config.delegationMiddleware) {
    const auth = config.authMiddleware;
    const delegation = config.delegationMiddleware;

    // GET /fireflies/pending — process all pending items
    router.get(
      "/fireflies/pending",
      auth,
      delegation,
      async (req: Request, res: Response) => {
        const access = req.delegatedAccess!;

        // 1. Read pending queue
        const pending = await readPendingQueue(backendKV);
        if (pending.length === 0) {
          res.json({ processed: [], skipped: [], errors: [] });
          return;
        }

        // 2. Get Fireflies API key from user's KV
        const apiKeyResult = await access.kv.get(FIREFLIES_KEY_PATH);
        const apiKey =
          apiKeyResult.ok && apiKeyResult.data.data
            ? String(apiKeyResult.data.data)
            : null;

        if (!apiKey) {
          res.status(400).json({
            error: "no_api_key",
            message: "Fireflies API key not configured",
          });
          return;
        }

        // 3. Process each pending item
        await ensureSchema(access);
        const client = makeClient(apiKey);

        const processed: SyncSingleResult[] = [];
        const skipped: SyncSingleResult[] = [];
        const errors: SyncSingleResult[] = [];
        const remaining: PendingItem[] = [];

        for (const item of pending) {
          const result = await doSync(item.meetingId, access, client);
          if (result.status === "created") {
            processed.push(result);
          } else if (result.status === "skipped") {
            skipped.push(result);
          } else {
            errors.push(result);
            remaining.push(item);
          }
        }

        // 4. Update queue — only failed items remain
        await backendKV.put(PENDING_KV_KEY, JSON.stringify(remaining));

        res.json({ processed, skipped, errors });
      },
    );

    // DELETE /fireflies/pending — clear all pending items
    router.delete(
      "/fireflies/pending",
      auth,
      delegation,
      async (_req: Request, res: Response) => {
        const pending = await readPendingQueue(backendKV);
        await backendKV.put(PENDING_KV_KEY, JSON.stringify([]));
        res.json({ cleared: pending.length });
      },
    );
  }

  return router;
}

// ── Helpers ──────────────────────────────────────────────────────────

interface PendingItem {
  meetingId: string;
  receivedAt: string;
}

async function readPendingQueue(backendKV: BackendKV): Promise<PendingItem[]> {
  const result = await backendKV.get(PENDING_KV_KEY);
  if (!result.ok || !result.data.data) return [];
  try {
    const parsed = JSON.parse(result.data.data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function storePending(backendKV: BackendKV, meetingId: string) {
  const existingResult = await backendKV.get(PENDING_KV_KEY);
  let pending: Array<{ meetingId: string; receivedAt: string }> = [];

  if (existingResult.ok && existingResult.data.data) {
    try {
      pending = JSON.parse(existingResult.data.data);
      if (!Array.isArray(pending)) pending = [];
    } catch {
      pending = [];
    }
  }

  pending.push({ meetingId, receivedAt: new Date().toISOString() });
  await backendKV.put(PENDING_KV_KEY, JSON.stringify(pending));
}

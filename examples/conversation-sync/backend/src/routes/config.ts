import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";

// ── Types ────────────────────────────────────────────────────────────

<<<<<<< HEAD
interface BackendKV {
  get(key: string): Promise<{ ok: boolean; data: { data: string | null } }>;
  put(key: string, value: string): Promise<{ ok: boolean }>;
}

interface ConfigRoutesConfig {
  authMiddleware: RequestHandler;
  delegationMiddleware: RequestHandler;
  backendKV?: BackendKV;
  frontendUrl?: string;
=======
interface ConfigRoutesConfig {
  authMiddleware: RequestHandler;
  delegationMiddleware: RequestHandler;
>>>>>>> 3e0b0dc (TC-1301: Add config endpoints for Fireflies API key (PUT/DELETE/GET exists))
}

// ── Constants ────────────────────────────────────────────────────────

const FIREFLIES_KEY_PATH = "/app.conversations/config/fireflies-key";
<<<<<<< HEAD
const WEBHOOK_SECRET_PATH = "/app.webhooks/config/fireflies-secret";
const WEBHOOK_USER_SUB_PATH = "/app.webhooks/config/user-sub";
const WEBHOOK_PENDING_PATH = "/app.webhooks/pending/fireflies";
=======
>>>>>>> 3e0b0dc (TC-1301: Add config endpoints for Fireflies API key (PUT/DELETE/GET exists))

// ── Config Routes ────────────────────────────────────────────────────

export function createConfigRouter(config: ConfigRoutesConfig) {
<<<<<<< HEAD
  const { authMiddleware, delegationMiddleware, backendKV } = config;
  const router = Router();

  // All config routes require auth
  router.use(authMiddleware);

  // ── Fireflies API key routes (auth + delegation) ──────────────────

  // ── PUT /api/config/fireflies-key — store API key ───────────────
  router.put("/fireflies-key", delegationMiddleware, async (req: Request, res: Response) => {
=======
  const { authMiddleware, delegationMiddleware } = config;
  const router = Router();

  // All config routes require auth + delegation
  router.use(authMiddleware);
  router.use(delegationMiddleware);

  // ── PUT /api/config/fireflies-key — store API key ───────────────
  router.put("/fireflies-key", async (req: Request, res: Response) => {
>>>>>>> 3e0b0dc (TC-1301: Add config endpoints for Fireflies API key (PUT/DELETE/GET exists))
    const { apiKey } = req.body;

    if (!apiKey || typeof apiKey !== "string") {
      res.status(400).json({
        error: "invalid_body",
        message: "Request body must include a non-empty 'apiKey' string field",
      });
      return;
    }

    try {
      await req.delegatedAccess!.kv.put(FIREFLIES_KEY_PATH, apiKey);
      res.json({ ok: true });
    } catch (err) {
      console.error("[config] failed to store fireflies key:", err);
      res.status(500).json({
        error: "store_failed",
        message: "Failed to store API key",
      });
    }
  });

  // ── DELETE /api/config/fireflies-key — remove API key ───────────
<<<<<<< HEAD
  router.delete("/fireflies-key", delegationMiddleware, async (req: Request, res: Response) => {
=======
  router.delete("/fireflies-key", async (req: Request, res: Response) => {
>>>>>>> 3e0b0dc (TC-1301: Add config endpoints for Fireflies API key (PUT/DELETE/GET exists))
    try {
      await req.delegatedAccess!.kv.delete(FIREFLIES_KEY_PATH);
      res.json({ ok: true });
    } catch (err) {
      console.error("[config] failed to delete fireflies key:", err);
      res.status(500).json({
        error: "delete_failed",
        message: "Failed to delete API key",
      });
    }
  });

  // ── GET /api/config/fireflies-key/exists — check existence ──────
<<<<<<< HEAD
  router.get("/fireflies-key/exists", delegationMiddleware, async (req: Request, res: Response) => {
    try {
      const result = await req.delegatedAccess!.kv.get(FIREFLIES_KEY_PATH);
      res.json({ exists: result.ok && result.data.data != null });
=======
  router.get("/fireflies-key/exists", async (req: Request, res: Response) => {
    try {
      const value = await req.delegatedAccess!.kv.get(FIREFLIES_KEY_PATH);
      res.json({ exists: value != null });
>>>>>>> 3e0b0dc (TC-1301: Add config endpoints for Fireflies API key (PUT/DELETE/GET exists))
    } catch (err) {
      console.error("[config] failed to check fireflies key:", err);
      res.status(500).json({
        error: "check_failed",
        message: "Failed to check API key existence",
      });
    }
  });

<<<<<<< HEAD
  // ── Webhook config routes (auth only, uses backend KV) ───────────

  if (backendKV) {
    // ── PUT /api/config/webhook-secret — store webhook secret ─────
    router.put("/webhook-secret", async (req: Request, res: Response) => {
      const { secret } = req.body;

      if (!secret || typeof secret !== "string") {
        res.status(400).json({
          error: "invalid_body",
          message: "Request body must include a non-empty 'secret' string field",
        });
        return;
      }

      try {
        await backendKV.put(WEBHOOK_SECRET_PATH, secret);
        // Store user sub so webhook handler can look up their delegation
        if (req.user?.sub) {
          await backendKV.put(WEBHOOK_USER_SUB_PATH, req.user.sub);
        }
        res.json({ ok: true });
      } catch (err) {
        console.error("[config] failed to store webhook secret:", err);
        res.status(500).json({
          error: "store_failed",
          message: "Failed to store webhook secret",
        });
      }
    });

    // ── GET /api/config/webhook-status — webhook configuration status
    router.get("/webhook-status", async (req: Request, res: Response) => {
      try {
        // Check if secret is configured
        const secretResult = await backendKV.get(WEBHOOK_SECRET_PATH);
        const configured = secretResult.ok && secretResult.data.data != null;

        // Count pending webhooks
        let pendingCount = 0;
        const pendingResult = await backendKV.get(WEBHOOK_PENDING_PATH);
        if (pendingResult.ok && pendingResult.data.data != null) {
          try {
            const pending = JSON.parse(pendingResult.data.data);
            pendingCount = Array.isArray(pending) ? pending.length : 0;
          } catch {
            // Invalid JSON — treat as 0 pending
          }
        }

        // Derive webhook URL — always use the backend's own host (not frontendUrl)
        const webhookUrl = `${req.protocol}://${req.get("host")}/api/webhooks/fireflies`;

        res.json({ configured, pendingCount, webhookUrl });
      } catch (err) {
        console.error("[config] failed to get webhook status:", err);
        res.status(500).json({
          error: "status_failed",
          message: "Failed to get webhook status",
        });
      }
    });
  }

=======
>>>>>>> 3e0b0dc (TC-1301: Add config endpoints for Fireflies API key (PUT/DELETE/GET exists))
  return router;
}

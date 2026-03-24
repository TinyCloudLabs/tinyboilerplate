import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";

// ── Types ────────────────────────────────────────────────────────────

interface ConfigRoutesConfig {
  authMiddleware: RequestHandler;
  delegationMiddleware: RequestHandler;
}

// ── Constants ────────────────────────────────────────────────────────

const FIREFLIES_KEY_PATH = "/app.conversations/config/fireflies-key";

// ── Config Routes ────────────────────────────────────────────────────

export function createConfigRouter(config: ConfigRoutesConfig) {
  const { authMiddleware, delegationMiddleware } = config;
  const router = Router();

  // All config routes require auth + delegation
  router.use(authMiddleware);
  router.use(delegationMiddleware);

  // ── PUT /api/config/fireflies-key — store API key ───────────────
  router.put("/fireflies-key", async (req: Request, res: Response) => {
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
  router.delete("/fireflies-key", async (req: Request, res: Response) => {
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
  router.get("/fireflies-key/exists", async (req: Request, res: Response) => {
    try {
      const value = await req.delegatedAccess!.kv.get(FIREFLIES_KEY_PATH);
      res.json({ exists: value != null });
    } catch (err) {
      console.error("[config] failed to check fireflies key:", err);
      res.status(500).json({
        error: "check_failed",
        message: "Failed to check API key existence",
      });
    }
  });

  return router;
}

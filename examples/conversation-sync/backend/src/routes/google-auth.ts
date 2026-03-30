import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
import { randomUUID } from "crypto";
import {
  buildAuthUrl as defaultBuildAuthUrl,
  exchangeCode as defaultExchangeCode,
} from "../services/google-auth.js";
import type { GoogleTokenResponse } from "../services/google-auth.js";

// ── Types ────────────────────────────────────────────────────────────

interface GoogleAuthRoutesConfig {
  authMiddleware: RequestHandler;
  delegationMiddleware: RequestHandler;
  resolveDelegation: (sub: string) => Promise<any>;
  /** Injectable for testing */
  buildAuthUrl?: (redirectUri: string, state: string) => string;
  exchangeCode?: (code: string, redirectUri: string) => Promise<GoogleTokenResponse>;
}

interface StateEntry {
  sub: string;
  createdAt: number;
}

// ── Constants ────────────────────────────────────────────────────────

const GOOGLE_TOKENS_PATH = "/app.conversations/config/google-tokens";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── State Store ──────────────────────────────────────────────────────

const pendingStates = new Map<string, StateEntry>();

function cleanExpiredStates() {
  const now = Date.now();
  for (const [key, entry] of pendingStates) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      pendingStates.delete(key);
    }
  }
}

// ── 501 guard ────────────────────────────────────────────────────────

function requireGoogleConfig(_req: Request, res: Response): boolean {
  if (!process.env.GOOGLE_CLIENT_ID) {
    res.status(501).json({
      error: "not_configured",
      message: "Google Meet integration is not configured",
    });
    return false;
  }
  return true;
}

// ── Auth Router ──────────────────────────────────────────────────────

export function createGoogleAuthRouter(config: GoogleAuthRoutesConfig) {
  const {
    authMiddleware,
    resolveDelegation,
    buildAuthUrl = defaultBuildAuthUrl,
    exchangeCode = defaultExchangeCode,
  } = config;
  const router = Router();

  // ── GET / — initiate OAuth (generates consent URL) ───────────────
  router.get("/", authMiddleware, (req: Request, res: Response) => {
    if (!requireGoogleConfig(req, res)) return;

    cleanExpiredStates();

    const state = randomUUID();
    pendingStates.set(state, { sub: req.user!.sub, createdAt: Date.now() });

    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
    const authUrl = buildAuthUrl(redirectUri, state);

    res.json({ authUrl });
  });

  // ── GET /callback — receive Google redirect (public) ─────────────
  router.get("/callback", async (req: Request, res: Response) => {
    if (!requireGoogleConfig(req, res)) return;

    const { code, state } = req.query;

    if (!code || !state || typeof code !== "string" || typeof state !== "string") {
      res.status(400).json({ error: "invalid_request", message: "Missing code or state" });
      return;
    }

    // Validate and consume state
    cleanExpiredStates();
    const stateEntry = pendingStates.get(state);
    if (!stateEntry) {
      res.status(400).json({ error: "invalid_state", message: "Invalid or expired state" });
      return;
    }
    pendingStates.delete(state); // consume — single use

    const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

    try {
      // Exchange code for tokens
      const tokens = await exchangeCode(code, redirectUri);

      // Resolve user's delegated access to store tokens in their KV
      const access = await resolveDelegation(stateEntry.sub);
      if (!access) {
        res.status(200).send(errorHtml("Delegation not found. Please sign in again."));
        return;
      }

      // Store tokens in user's KV
      await access.kv.put(GOOGLE_TOKENS_PATH, JSON.stringify(tokens));

      res.status(200).send(successHtml());
    } catch (err) {
      console.error("[google-auth] callback error:", err);
      res.status(200).send(errorHtml("Failed to connect Google account."));
    }
  });

  return router;
}

// ── HTML Responses ──────────────────────────────────────────────────

function successHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>Connected</title></head>
<body>
<script>
  window.opener.postMessage({ type: 'google-auth-success' }, '*');
  window.close();
</script>
<p>Google account connected. You can close this window.</p>
</body></html>`;
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html><head><title>Error</title></head>
<body>
<script>
  window.opener.postMessage({ type: 'google-auth-error', message: ${JSON.stringify(message)} }, '*');
  window.close();
</script>
<p>${message}</p>
</body></html>`;
}

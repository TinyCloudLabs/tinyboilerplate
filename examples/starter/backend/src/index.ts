import "./types/index.js";

import { existsSync, readFileSync } from "fs";
import { createServer as createHttpsServer } from "https";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { apiReference } from "@scalar/express-api-reference";
import { load as loadYaml } from "js-yaml";
import {
  DelegationStore,
  DelegationCache,
  createCsrfMiddleware,
  createNonceStore,
} from "@tinyboilerplate/server";

import { createAuthMiddleware } from "./middleware/auth.js";
import { createDelegationMiddleware } from "./middleware/delegation.js";
import { createAuthRouter } from "./routes/auth.js";
import { createServerInfoRouter } from "./routes/server-info.js";
import { createDelegationRouter } from "./routes/delegations.js";
import { createItemsRouter } from "./routes/items.js";
import { applySecurityDefaults } from "./security.js";
import { createBackendIdentityWithRetry, installTinyCloudCompatibilityFetch } from "./startup.js";

// ── Environment ──────────────────────────────────────────────────────

const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY;
const TINYCLOUD_HOST = process.env.TINYCLOUD_HOST ?? "https://node.tinycloud.xyz";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
const PORT = parseInt(process.env.PORT ?? "3001", 10);
const HTTPS_CERT_FILE = process.env.HTTPS_CERT_FILE;
const HTTPS_KEY_FILE = process.env.HTTPS_KEY_FILE;

if (!BACKEND_PRIVATE_KEY) {
  console.error(
    "BACKEND_PRIVATE_KEY is required. Generate one from the repo root with `bun run generate-key`, then set examples/starter/backend/.env.",
  );
  process.exit(1);
}

// ── Bootstrap ────────────────────────────────────────────────────────

async function main() {
  installTinyCloudCompatibilityFetch();

  // 1. Initialize backend identity (sign in to TinyCloud)
  console.log("Signing in to TinyCloud...");
  const { node, did } = await createBackendIdentityWithRetry(
    {
      privateKey: BACKEND_PRIVATE_KEY,
      host: TINYCLOUD_HOST,
    },
    {
      attempts: 30,
      initialDelayMs: 1_000,
      maxDelayMs: 10_000,
      onRetry: (err, attempt, delayMs) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `TinyCloud sign-in failed during startup (attempt ${attempt}); retrying in ${delayMs}ms: ${message}`,
        );
      },
    },
  );

  // 2. Create delegation infrastructure
  const delegationStore = new DelegationStore(node);
  const delegationCache = new DelegationCache();

  // 3. Create auth infrastructure
  const nonceStore = createNonceStore();
  const authMiddleware = createAuthMiddleware(BACKEND_PRIVATE_KEY);

  const delegationMiddleware = createDelegationMiddleware({
    node,
    store: delegationStore,
    cache: delegationCache,
  });

  // 4. Set up Express
  const app = express();
  applySecurityDefaults(app);
  app.use(cors({ origin: FRONTEND_URL }));
  app.use(express.json());
  app.use(createCsrfMiddleware());

  // 5. Rate limiting
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", message: "Too many auth requests" },
  });

  const delegationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", message: "Too many delegation requests" },
  });

  app.use(generalLimiter);

  // 6. Mount routes
  app.use("/api/server-info", createServerInfoRouter(did));

  app.use(
    "/api/auth",
    authLimiter,
    createAuthRouter({
      nonceStore,
      privateKey: BACKEND_PRIVATE_KEY,
    }),
  );

  app.use(
    "/api/delegations",
    delegationLimiter,
    createDelegationRouter({
      node,
      did,
      store: delegationStore,
      cache: delegationCache,
      authMiddleware,
    }),
  );

  app.use("/api/items", authMiddleware, delegationMiddleware, createItemsRouter());

  // 7. OpenAPI docs
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const spec = loadYaml(readFileSync(resolve(__dirname, "../openapi.yaml"), "utf-8")) as object;
  app.get("/api/openapi.json", (_req, res) => res.json(spec));
  app.use("/api/docs", apiReference({ spec: { content: spec } }));

  // 8. Start server
  const tlsConfig = loadTlsConfig();
  const server = tlsConfig
    ? createHttpsServer(tlsConfig, app).listen(PORT, () => {
        console.log(`Backend ready. DID: ${did}`);
        console.log(`Listening on https://localhost:${PORT}`);
      })
    : app.listen(PORT, () => {
        console.log(`Backend ready. DID: ${did}`);
        console.log(`Listening on http://localhost:${PORT}`);
      });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log("HTTP server closed.");
    });
    // Wait for in-flight requests (max 10s)
    setTimeout(() => {
      console.log("Forced shutdown after timeout.");
      process.exit(0);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function loadTlsConfig() {
  if (!HTTPS_CERT_FILE && !HTTPS_KEY_FILE) {
    return null;
  }
  if (!HTTPS_CERT_FILE || !HTTPS_KEY_FILE) {
    throw new Error("Both HTTPS_CERT_FILE and HTTPS_KEY_FILE are required to enable HTTPS.");
  }

  const certFile = resolve(process.cwd(), HTTPS_CERT_FILE);
  const keyFile = resolve(process.cwd(), HTTPS_KEY_FILE);
  if (!existsSync(certFile) || !existsSync(keyFile)) {
    throw new Error(`HTTPS certificate files were not found: ${certFile}, ${keyFile}`);
  }

  return {
    cert: readFileSync(certFile),
    key: readFileSync(keyFile),
  };
}

main().catch((err) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});

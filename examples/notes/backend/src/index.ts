import "./types/index.js";

import { existsSync, readFileSync } from "fs";
import { createServer as createHttpsServer } from "https";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import express from "express";
import { apiReference } from "@scalar/express-api-reference";
import { load as loadYaml } from "js-yaml";
import {
  DelegationCache,
  DelegationStore,
  applyRateLimiter,
  createCsrfMiddleware,
  createNonceStore,
} from "@tinyboilerplate/server";
import { applySecurityDefaults } from "./security.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createDelegationMiddleware } from "./middleware/delegation.js";
import { createAuthRouter } from "./routes/auth.js";
import { createDelegationRouter } from "./routes/delegations.js";
import { createManifestRouter } from "./routes/manifest.js";
import { createNotesRouter } from "./routes/notes.js";
import { createServerInfoRouter } from "./routes/server-info.js";
import { createNotesBackendIdentity } from "./startup.js";

const BACKEND_PRIVATE_KEY = process.env.BACKEND_PRIVATE_KEY;
const TINYCLOUD_HOST = process.env.TINYCLOUD_HOST ?? "https://node.tinycloud.xyz";
const PORT = Number.parseInt(process.env.PORT ?? "3002", 10);
const DEFAULT_HTTPS_CERT_FILE = "../frontend/localhost.pem";
const DEFAULT_HTTPS_KEY_FILE = "../frontend/localhost-key.pem";
const hasDefaultTlsFiles =
  existsSync(resolve(process.cwd(), DEFAULT_HTTPS_CERT_FILE)) &&
  existsSync(resolve(process.cwd(), DEFAULT_HTTPS_KEY_FILE));
const HTTPS_CERT_FILE =
  process.env.HTTPS_CERT_FILE ?? (hasDefaultTlsFiles ? DEFAULT_HTTPS_CERT_FILE : undefined);
const HTTPS_KEY_FILE =
  process.env.HTTPS_KEY_FILE ?? (hasDefaultTlsFiles ? DEFAULT_HTTPS_KEY_FILE : undefined);
const FRONTEND_URL =
  process.env.FRONTEND_URL ??
  (HTTPS_CERT_FILE && HTTPS_KEY_FILE ? "https://localhost:5174" : "http://localhost:5174");

if (!BACKEND_PRIVATE_KEY) {
  console.error(
    "BACKEND_PRIVATE_KEY is required. Generate one from the repo root with `bun run generate-key`.",
  );
  process.exit(1);
}
const backendPrivateKey = BACKEND_PRIVATE_KEY;

async function main() {
  const { node, did } = await createNotesBackendIdentity({
    privateKey: backendPrivateKey,
    host: TINYCLOUD_HOST,
  });
  const delegationStore = new DelegationStore(node);
  const delegationCache = new DelegationCache();
  const nonceStore = createNonceStore();
  const authMiddleware = createAuthMiddleware(backendPrivateKey);
  const delegationMiddleware = createDelegationMiddleware({
    node,
    store: delegationStore,
    cache: delegationCache,
    backendDid: did,
  });

  const app = express();
  applySecurityDefaults(app);
  app.use(cors({ origin: FRONTEND_URL }));
  app.use(express.json({ limit: "64kb" }));
  app.use(createCsrfMiddleware());
  applyRateLimiter(app);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, app: "xyz.tinycloud.notes" });
  });
  app.use("/api/manifest", createManifestRouter());
  app.use("/api/server-info", createServerInfoRouter(did));
  app.use(
    "/api/auth",
    createAuthRouter({
      nonceStore,
      privateKey: backendPrivateKey,
    }),
  );
  app.use(
    "/api/delegations",
    createDelegationRouter({
      node,
      backendDid: did,
      store: delegationStore,
      cache: delegationCache,
      authMiddleware,
    }),
  );
  app.use("/api/notes", authMiddleware, delegationMiddleware, createNotesRouter());

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const spec = loadYaml(readFileSync(resolve(__dirname, "../openapi.yaml"), "utf-8")) as object;
  app.get("/api/openapi.json", (_req, res) => res.json(spec));
  app.use("/api/docs", apiReference({ spec: { content: spec } }));

  const tlsConfig = loadTlsConfig();
  const server = tlsConfig
    ? createHttpsServer(tlsConfig, app).listen(PORT, () => {
        console.log(`TinyCloud Notes backend ready: https://localhost:${PORT}`);
      })
    : app.listen(PORT, () => {
        console.log(`TinyCloud Notes backend ready: http://localhost:${PORT}`);
      });

  const shutdown = (signal: string) => {
    console.log(`${signal} received. Shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function loadTlsConfig() {
  if (!HTTPS_CERT_FILE && !HTTPS_KEY_FILE) return null;
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

main().catch((error) => {
  console.error("Failed to start TinyCloud Notes backend:", error);
  process.exit(1);
});

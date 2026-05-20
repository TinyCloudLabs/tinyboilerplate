import { Router } from "express";
import type { ServerInfo } from "@tinyboilerplate/core";
import {
  BACKEND_DELEGATION_PERMISSIONS,
  getBackendDelegationPolicyHash,
} from "../backend-policy.js";

export { getBackendDelegationPolicyHash };

// ── Server Info Route ────────────────────────────────────────────────

/**
 * GET /api/server-info
 *
 * Returns the backend's {@link ServerInfo}: identity, name, delegation
 * expiry, and the permissions the backend needs the user to delegate.
 * No auth required.
 *
 * The frontend consumes this response at sign-in time to compose a
 * manifest that pre-declares the delegation to this backend. That
 * manifest drives the SIWE recap so the session key already holds the
 * capabilities the backend needs — the delegation is then issued via
 * the session-key UCAN path in one wallet prompt for the whole flow.
 */
export function createServerInfoRouter(did: string) {
  const router = Router();

  // Permissions the backend needs the user to grant. These are the
  // capabilities every authenticated data route (`/api/items`, etc)
  // touches, across KV, SQL, and DuckDB stores.
  //
  // Space is omitted so the manifest default applies: the application
  // space. Paths are app-relative and resolve under the manifest
  // `app_id` prefix (`xyz.tinycloud.starter/`) during composition.
  router.get("/", (_req, res) => {
    const info: ServerInfo = {
      did,
      status: "ready",
      name: "TinyCloud Starter Backend",
      expiry: "7d",
      permissions: BACKEND_DELEGATION_PERMISSIONS,
    };
    res.json(info);
  });

  return router;
}

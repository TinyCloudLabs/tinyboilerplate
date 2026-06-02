import { Router } from "express";
import type { Request, Response } from "express";
import { InputError, deleteProbe, getProbe, putProbe } from "../storage/probe.js";

export function createProbeRouter() {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    const access = requireDelegation(req, res);
    if (!access) return;
    try {
      const probe = await getProbe(access);
      res.json({ probe });
    } catch (error) {
      handleRouteError(res, error, "read probe");
    }
  });

  router.put("/", async (req: Request, res: Response) => {
    const access = requireDelegation(req, res);
    if (!access) return;
    try {
      const probe = await putProbe(access, req.body);
      res.json({ probe });
    } catch (error) {
      handleRouteError(res, error, "write probe");
    }
  });

  router.delete("/", async (req: Request, res: Response) => {
    const access = requireDelegation(req, res);
    if (!access) return;
    try {
      await deleteProbe(access);
      res.status(204).send();
    } catch (error) {
      handleRouteError(res, error, "delete probe");
    }
  });

  return router;
}

function requireDelegation(req: Request, res: Response) {
  if (!req.delegatedAccess) {
    res.status(403).json({ error: "no_delegation", message: "Delegation required" });
    return null;
  }
  return req.delegatedAccess;
}

function handleRouteError(res: Response, error: unknown, operation: string): void {
  if (error instanceof InputError) {
    res.status(400).json({ error: error.code, message: error.message });
    return;
  }
  console.error(`[probe] failed to ${operation}:`, error);
  res.status(500).json({ error: "store_error", message: `Failed to ${operation}` });
}

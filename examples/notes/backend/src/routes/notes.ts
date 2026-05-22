import { Router } from "express";
import type { Request, Response } from "express";
import {
  InputError,
  createNote,
  deleteNote,
  getNote,
  listNotes,
  updateNote,
} from "../storage/notes.js";

export function createNotesRouter() {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    const access = requireDelegation(req, res);
    if (!access) return;
    try {
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const notes = await listNotes(access, search);
      res.json({ notes });
    } catch (error) {
      handleRouteError(res, error, "list notes");
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    const access = requireDelegation(req, res);
    if (!access) return;
    if (containsSecretLikeValue(req.body)) {
      res.status(400).json({
        error: "secret_like_value",
        message: "Secret-like values are not accepted by backend note routes.",
      });
      return;
    }
    try {
      const note = await createNote(access, req.body);
      res.status(201).json({ note });
    } catch (error) {
      handleRouteError(res, error, "create note");
    }
  });

  router.get("/:id", async (req: Request, res: Response) => {
    const access = requireDelegation(req, res);
    if (!access) return;
    try {
      const note = await getNote(access, req.params.id);
      if (!note) {
        res.status(404).json({ error: "not_found", message: `Note '${req.params.id}' not found` });
        return;
      }
      res.json({ note });
    } catch (error) {
      handleRouteError(res, error, "get note");
    }
  });

  router.put("/:id", async (req: Request, res: Response) => {
    const access = requireDelegation(req, res);
    if (!access) return;
    if (containsSecretLikeValue(req.body)) {
      res.status(400).json({
        error: "secret_like_value",
        message: "Secret-like values are not accepted by backend note routes.",
      });
      return;
    }
    try {
      const note = await updateNote(access, req.params.id, req.body);
      if (!note) {
        res.status(404).json({ error: "not_found", message: `Note '${req.params.id}' not found` });
        return;
      }
      res.json({ note });
    } catch (error) {
      handleRouteError(res, error, "update note");
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const access = requireDelegation(req, res);
    if (!access) return;
    try {
      const deleted = await deleteNote(access, req.params.id);
      if (!deleted) {
        res.status(404).json({ error: "not_found", message: `Note '${req.params.id}' not found` });
        return;
      }
      res.status(204).send();
    } catch (error) {
      handleRouteError(res, error, "delete note");
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
  console.error(`[notes] failed to ${operation}:`, error);
  res.status(500).json({ error: "store_error", message: `Failed to ${operation}` });
}

function containsSecretLikeValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /(api[_-]?key|secret|password|private[_-]?key|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]{6,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some(containsSecretLikeValue);
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, entry]) =>
        /(api[_-]?key|secret|password|private[_-]?key|token)/i.test(key) ||
        containsSecretLikeValue(entry),
    );
  }
  return false;
}

import { randomUUID } from "crypto";
import { isStorageFullError } from "@tinyboilerplate/core";
import type { DelegatedAccess } from "@tinyboilerplate/server";
import { NOTE_BODY_KV_PREFIX, NOTES_SQL_DATABASE_ID } from "../manifest.js";

export interface NoteMetadata {
  id: string;
  title: string;
  url?: string;
  tags: string[];
  bodyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface Note extends NoteMetadata {
  body: string;
}

export interface CreateNoteInput {
  title: string;
  url?: string;
  tags?: string[] | string;
  body?: string;
}

export interface UpdateNoteInput {
  title?: string;
  url?: string | null;
  tags?: string[] | string;
  body?: string;
}

type SqlService = Pick<DelegatedAccess["sql"], "execute" | "query">;
type StoreFailure = { code?: string; message: string };

/** Accesses whose notes table is known to exist; skips the schema read. */
const schemaReady = new WeakSet<object>();

// Runs only after a read showed the table missing; IF NOT EXISTS keeps two
// concurrent first saves from failing each other.
const NOTES_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    body_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

export function noteBodyKey(id: string): string {
  return `${NOTE_BODY_KV_PREFIX}${id}`;
}

export function notesSql(access: DelegatedAccess): SqlService {
  const sql = access.sql as SqlService & { db?: (name: string) => SqlService };
  return typeof sql.db === "function" ? sql.db(NOTES_SQL_DATABASE_ID) : sql;
}

/**
 * Read-first schema setup for write paths. Checks for the notes table with a
 * read and creates it only when it is missing, so an up-to-date database never
 * sends a write before the caller's own write. On a full account that matters:
 * the node refuses writes that would grow storage, but reads keep working.
 */
export async function ensureNotesSchema(access: DelegatedAccess): Promise<void> {
  if (schemaReady.has(access)) return;
  const sql = notesSql(access);
  const probe = await sql.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
  );
  if (!probe.ok && !isMissingSchema(probe.error)) {
    throw storeError("Failed to read notes schema", probe.error);
  }
  if (!probe.ok || probe.data.rows.length === 0) {
    const created = await sql.execute(NOTES_TABLE_DDL);
    if (!created.ok) throw storeError("Failed to create notes table", created.error);
  }
  schemaReady.add(access);
}

/**
 * Lists notes without writing. A database or table that does not exist yet
 * means there are no notes; the schema is created by the first save.
 */
export async function listNotes(access: DelegatedAccess, search?: string): Promise<Note[]> {
  const sql = notesSql(access);
  const trimmed = search?.trim();
  const params: string[] = [];
  let statement = "SELECT id, title, url, tags, body_key, created_at, updated_at FROM notes";
  if (trimmed) {
    statement += " WHERE title LIKE ? OR url LIKE ? OR tags LIKE ?";
    params.push(`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`);
  }
  statement += " ORDER BY updated_at DESC";

  const result = await sql.query(statement, params);
  if (!result.ok) {
    if (isMissingSchema(result.error)) return [];
    throw storeError("Failed to list notes", result.error);
  }
  schemaReady.add(access);

  const hydrated = await Promise.all(
    result.data.rows.map((row) => hydrateNote(access, rowToMetadata(row, result.data.columns))),
  );
  const notes = hydrated.filter((note): note is Note => note !== null);

  if (!trimmed) return notes;
  const lower = trimmed.toLowerCase();
  return notes.filter((note) =>
    [note.title, note.url ?? "", note.tags.join(","), note.body].some((value) =>
      value.toLowerCase().includes(lower),
    ),
  );
}

/** Reads one note without writing; a missing schema means it does not exist. */
export async function getNote(access: DelegatedAccess, id: string): Promise<Note | null> {
  const sql = notesSql(access);
  const result = await sql.query(
    "SELECT id, title, url, tags, body_key, created_at, updated_at FROM notes WHERE id = ?",
    [id],
  );
  if (!result.ok) {
    if (isMissingSchema(result.error)) return null;
    throw storeError("Failed to get note", result.error);
  }
  schemaReady.add(access);
  if (result.data.rows.length === 0) return null;
  return hydrateNote(access, rowToMetadata(result.data.rows[0], result.data.columns));
}

export async function createNote(access: DelegatedAccess, input: CreateNoteInput): Promise<Note> {
  const now = new Date().toISOString();
  const metadata: NoteMetadata = {
    id: randomUUID(),
    title: normalizeTitle(input.title),
    url: normalizeUrl(input.url),
    tags: normalizeTags(input.tags),
    bodyKey: "",
    createdAt: now,
    updatedAt: now,
  };
  metadata.bodyKey = noteBodyKey(metadata.id);
  const body = normalizeBody(input.body);
  await ensureNotesSchema(access);

  const put = await access.kv.put(metadata.bodyKey, body);
  if (!put.ok) throw storeError("Failed to create note body", put.error);

  const sql = notesSql(access);
  const insert = await sql.execute(
    `INSERT INTO notes (id, title, url, tags, body_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      metadata.id,
      metadata.title,
      metadata.url ?? null,
      JSON.stringify(metadata.tags),
      metadata.bodyKey,
      metadata.createdAt,
      metadata.updatedAt,
    ],
  );
  if (!insert.ok) {
    await access.kv.delete(metadata.bodyKey);
    throw storeError("Failed to create note metadata", insert.error);
  }
  return { ...metadata, body };
}

export async function updateNote(
  access: DelegatedAccess,
  id: string,
  input: UpdateNoteInput,
): Promise<Note | null> {
  const existing = await getNote(access, id);
  if (!existing) return null;

  const updated: Note = {
    ...existing,
    title: input.title !== undefined ? normalizeTitle(input.title) : existing.title,
    url: input.url !== undefined ? normalizeUrl(input.url ?? undefined) : existing.url,
    tags: input.tags !== undefined ? normalizeTags(input.tags) : existing.tags,
    body: input.body !== undefined ? normalizeBody(input.body) : existing.body,
    updatedAt: new Date().toISOString(),
  };

  const bodyChanged = input.body !== undefined;
  if (bodyChanged) {
    const put = await access.kv.put(updated.bodyKey, updated.body);
    if (!put.ok) throw storeError("Failed to update note body", put.error);
  }

  const sql = notesSql(access);
  const result = await sql.execute(
    `UPDATE notes SET title = ?, url = ?, tags = ?, body_key = ?, updated_at = ? WHERE id = ?`,
    [
      updated.title,
      updated.url ?? null,
      JSON.stringify(updated.tags),
      updated.bodyKey,
      updated.updatedAt,
      id,
    ],
  );
  if (!result.ok) {
    if (bodyChanged) {
      const restore = await access.kv.put(existing.bodyKey, existing.body);
      if (!restore.ok) {
        if (isStorageFullError(result.error)) {
          throw new PartialSaveError(
            "The note text was saved, but its title, URL, and tags were not, because your TinyCloud storage is full.",
            result.error,
          );
        }
        throw new Error(
          `Failed to update note metadata: ${result.error.message}; failed to restore note body: ${restore.error.message}`,
          { cause: result.error },
        );
      }
    }
    throw storeError("Failed to update note metadata", result.error);
  }
  return updated;
}

export async function deleteNote(access: DelegatedAccess, id: string): Promise<boolean> {
  const existing = await getNote(access, id);
  if (!existing) return false;

  const deleted = await access.kv.delete(existing.bodyKey);
  if (!deleted.ok) throw storeError("Failed to delete note body", deleted.error);

  const sql = notesSql(access);
  const result = await sql.execute("DELETE FROM notes WHERE id = ?", [id]);
  if (!result.ok) {
    const restore = await access.kv.put(existing.bodyKey, existing.body);
    if (!restore.ok) {
      if (isStorageFullError(result.error)) {
        throw new PartialSaveError(
          "The note text was deleted, but its title, URL, and tags were not, because your TinyCloud storage is full.",
          result.error,
        );
      }
      throw new Error(
        `Failed to delete note metadata: ${result.error.message}; failed to restore note body: ${restore.error.message}`,
        { cause: result.error },
      );
    }
    throw storeError("Failed to delete note metadata", result.error);
  }
  return true;
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InputError("invalid_body", "Request body must include a non-empty title.");
  }
  return value.trim();
}

function normalizeBody(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new InputError("invalid_body", "Note body must be a string.");
  }
  return value;
}

function normalizeUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new InputError("invalid_body", "Note URL must be a string.");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url.toString();
  } catch {
    throw new InputError("invalid_body", "Note URL must be a valid http(s) URL.");
  }
}

export function normalizeTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const unique = new Set<string>();
  for (const tag of raw) {
    if (typeof tag !== "string") continue;
    const clean = tag.trim().toLowerCase();
    if (clean) unique.add(clean);
  }
  return [...unique].slice(0, 12);
}

function rowToMetadata(row: unknown[], columns: string[]): NoteMetadata {
  const obj: Record<string, unknown> = {};
  columns.forEach((column, index) => {
    obj[column] = row[index];
  });
  return {
    id: String(obj.id),
    title: String(obj.title),
    url: typeof obj.url === "string" && obj.url.length > 0 ? obj.url : undefined,
    tags: parseTags(obj.tags),
    bodyKey: String(obj.body_key),
    createdAt: String(obj.created_at),
    updatedAt: String(obj.updated_at),
  };
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string");
  if (typeof value !== "string" || value === "") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

async function hydrateNote(access: DelegatedAccess, metadata: NoteMetadata): Promise<Note | null> {
  const result = await access.kv.get(metadata.bodyKey);
  if (!result.ok) {
    if (isMissingNoteBody(result.error)) return null;
    throw new Error(`Failed to read note body: ${result.error.message}`);
  }
  const raw = result.data?.data;
  return {
    ...metadata,
    body: typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw),
  };
}

function isMissingNoteBody(error: { message?: string }): boolean {
  return /not found/i.test(error.message ?? "");
}

/**
 * A database the node never created answers "database not found"; a database
 * without the table answers "no such table". Both mean the schema is missing.
 */
function isMissingSchema(error: StoreFailure): boolean {
  return (
    error.code === "SQL_DATABASE_NOT_FOUND" ||
    /no such table|database not found/i.test(error.message)
  );
}

/** Keeps the SDK error as `cause` so callers can still read its code. */
function storeError(message: string, cause: StoreFailure): Error {
  return new Error(`${message}: ${cause.message}`, { cause });
}

/**
 * Part of a change was stored and part was not because storage is full. The
 * message says exactly which part, so the UI can show it as-is.
 */
export class PartialSaveError extends Error {
  constructor(message: string, cause: StoreFailure) {
    super(message, { cause });
    this.name = "PartialSaveError";
  }
}

export class InputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

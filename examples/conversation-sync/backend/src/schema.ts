import type { DelegatedAccess } from "@tinyboilerplate/server";

/** Database name for the conversations SQL store. */
export const DATABASE_NAME = "conversations";

/**
 * SQL statements to initialize the conversations schema.
 * Each statement is executed separately since TinyCloud SQL
 * handles one statement per execute() call.
 */
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS conversation (
    id              TEXT PRIMARY KEY,
    title           TEXT,
    source          TEXT NOT NULL,
    source_id       TEXT,
    source_url      TEXT,
    started_at      TEXT,
    ended_at        TEXT,
    duration_secs   REAL,
    summary         TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(source, source_id)
  )`,
  `CREATE TABLE IF NOT EXISTS participant (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    email           TEXT,
    speaker_label   TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_convo_source ON conversation(source, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_convo_started ON conversation(started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_participant_convo ON participant(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_participant_email ON participant(email)`,
];

/**
 * Track schema initialization per DelegatedAccess instance.
 * WeakMap ensures cleanup when the access object is GC'd.
 */
const schemaInitialized = new WeakMap<object, boolean>();

/**
 * Ensure the conversations schema exists. Runs CREATE TABLE/INDEX
 * statements at most once per DelegatedAccess instance.
 */
export async function ensureSchema(access: DelegatedAccess): Promise<void> {
  if (schemaInitialized.has(access)) return;

  for (const sql of SCHEMA_STATEMENTS) {
    const result = await access.sql.execute(sql);
    if (!result.ok) {
      throw new Error(
        `Failed to initialize conversations schema: ${(result as any).error.message}`,
      );
    }
  }

  schemaInitialized.set(access, true);
}

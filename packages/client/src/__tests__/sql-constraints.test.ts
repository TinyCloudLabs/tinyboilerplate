import { describe, test, expect } from "bun:test";
import {
  isDdlStatement,
  assertDdlActionsGranted,
  resolveSqlDbHandle,
  assertFullPathDbHandle,
} from "../storage/sql-constraints.js";

describe("isDdlStatement", () => {
  test("recognizes DDL statements", () => {
    for (const sql of [
      "CREATE TABLE tasks (id TEXT)",
      "  create table if not exists tasks (id TEXT)",
      "CREATE INDEX idx ON tasks (updated_at)",
      "CREATE UNIQUE INDEX idx ON tasks (id)",
      "ALTER TABLE tasks ADD COLUMN x TEXT",
      "DROP TABLE tasks",
      "DROP INDEX idx",
      "CREATE TRIGGER t AFTER INSERT ON tasks BEGIN END",
      "CREATE VIEW v AS SELECT 1",
      "REINDEX tasks",
    ]) {
      expect(isDdlStatement(sql)).toBe(true);
    }
  });

  test("does NOT flag DML as DDL", () => {
    for (const sql of [
      "SELECT * FROM tasks",
      "INSERT INTO tasks (id) VALUES (?)",
      "UPDATE tasks SET done = 1 WHERE id = ?",
      "DELETE FROM tasks WHERE id = ?",
      // A row that merely mentions the word 'create' in a string is not DDL.
      "INSERT INTO log (msg) VALUES ('create table happened')",
    ]) {
      expect(isDdlStatement(sql)).toBe(false);
    }
  });
});

describe("assertDdlActionsGranted", () => {
  test("throws when DDL is present but 'schema' is not granted (the core rule)", () => {
    expect(() =>
      assertDdlActionsGranted(["CREATE TABLE tasks (id TEXT)"], ["read", "write"]),
    ).toThrow(/requires the "schema" ability/);
    // CREATE INDEX is DDL too — not a special per-statement blocklist.
    expect(() =>
      assertDdlActionsGranted(["CREATE INDEX idx ON tasks (updated_at)"], ["read", "write"]),
    ).toThrow(/schema/);
  });

  test("passes when 'schema' IS granted — an app may freely CREATE INDEX", () => {
    expect(() =>
      assertDdlActionsGranted(
        ["CREATE TABLE tasks (id TEXT)", "CREATE INDEX idx ON tasks (updated_at)"],
        ["read", "write", "schema"],
      ),
    ).not.toThrow();
  });

  test("passes when there is no DDL at all, regardless of grant", () => {
    expect(() =>
      assertDdlActionsGranted(["SELECT * FROM tasks", "INSERT INTO tasks VALUES (?)"], ["read"]),
    ).not.toThrow();
  });
});

describe("resolveSqlDbHandle", () => {
  test("builds the full path ${appId}/${db}", () => {
    expect(resolveSqlDbHandle("xyz.tinycloud.tasks", "tasks")).toBe("xyz.tinycloud.tasks/tasks");
  });

  test("rejects a slashed db name (double-prefix trap)", () => {
    expect(() => resolveSqlDbHandle("xyz.tinycloud.tasks", "xyz.tinycloud.tasks/tasks")).toThrow(
      /single segment/,
    );
  });

  test("rejects empty inputs", () => {
    expect(() => resolveSqlDbHandle("", "tasks")).toThrow(/appId/);
    expect(() => resolveSqlDbHandle("app", "")).toThrow(/db name/);
  });
});

describe("assertFullPathDbHandle", () => {
  test("accepts a full resolved path", () => {
    expect(() =>
      assertFullPathDbHandle("xyz.tinycloud.tasks/tasks", "xyz.tinycloud.tasks"),
    ).not.toThrow();
  });

  test("rejects a bare db name (the browser-direct 401 trap)", () => {
    expect(() => assertFullPathDbHandle("tasks", "xyz.tinycloud.tasks")).toThrow(
      /FULL resolved path/,
    );
  });

  test("rejects a handle that is only the prefix with no db segment", () => {
    expect(() => assertFullPathDbHandle("xyz.tinycloud.tasks/", "xyz.tinycloud.tasks")).toThrow();
  });
});

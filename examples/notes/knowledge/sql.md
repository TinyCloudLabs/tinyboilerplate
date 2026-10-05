---
type: TinyCloud SQL
title: SQL
description: Notes metadata index.
tinycloud:
  app: xyz.tinycloud.notes
  service: sql
  profile: tinycloud.app.v1
  sensitivity: user-data
  containsSecretValue: false
---

# SQL

Database: `notes_index`

Engine: SQLite

Purpose: Store searchable note metadata including title, URL, tags, and the KV
body pointer.

Required capabilities:

| Capability | Why |
| --- | --- |
| `tinycloud.sql/read` | List and search note metadata. |
| `tinycloud.sql/write` | Create, update, and delete note metadata. |

## Tables

| Table | Purpose | Agent Notes |
| --- | --- | --- |
| `notes` | Metadata for user-owned notes. | Keep rows in sync with KV note bodies. |

Agent notes:

- SQL metadata is part of the app's user data model.
- A failed split write must be handled explicitly by app code and tests.
- Reads never write. List and get run their `SELECT` directly; a missing
  table or database means no notes yet. Only saves create the schema, after a
  read shows it is missing.
- When the owner's TinyCloud storage is full, writes fail with
  `STORAGE_QUOTA_EXCEEDED` (HTTP 402) or `STORAGE_LIMIT_REACHED` (HTTP 413)
  while reads keep working. Relay the response `message`, which says what
  happened: usually that the change was not saved, but when the response has
  `partial: true` part of the change was stored (for example the note text but
  not its title, URL, and tags), so say which part. Tell the owner reading still
  works; do not retry, and stop bulk work at the first rejection.

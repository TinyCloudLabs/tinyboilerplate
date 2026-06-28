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

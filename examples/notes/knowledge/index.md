---
type: TinyCloud App
title: TinyCloud Notes
description: Create, edit, search, and delete user-owned notes stored in TinyCloud.
tinycloud:
  app: xyz.tinycloud.notes
  profile: tinycloud.app.v1
  containsSecretValue: false
---

# TinyCloud Notes

TinyCloud Notes is the first real example app in this repo. It demonstrates
user-owned app data, backend delegation, SQL metadata, and KV note bodies.

## Resources

- [SQL](sql.md) - Search and list metadata in `notes_index`.
- [KV](kv.md) - Note body content under `entries/`.

## Runtime Contract

- `/api/manifest` serves the app manifest.
- `/api/server-info` serves backend delegation policy.
- The browser owns user sign-in and consent.
- The backend reads and writes user data only through delegated TinyCloud access.

## Agent Notes

- Treat SQL rows as metadata for user-owned notes.
- Treat KV entries as the note body source of truth.
- Do not add secret values to this knowledge bundle.

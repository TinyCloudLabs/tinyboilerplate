---
type: TinyCloud KV
title: KV
description: Note body documents.
tinycloud:
  app: xyz.tinycloud.notes
  service: kv
  profile: tinycloud.app.v1
  sensitivity: user-data
  containsSecretValue: false
---

# KV

## Note Bodies

Prefix: `entries/`

Purpose: Store user-authored note body content by note id.

Access:

| Capability | Why |
| --- | --- |
| `tinycloud.kv/get` | Read note bodies. |
| `tinycloud.kv/put` | Save note bodies. |
| `tinycloud.kv/del` | Delete note bodies when users delete notes. |
| `tinycloud.kv/list` | Support diagnostics and future repair flows. |

Agent notes:

- Preserve user-authored text exactly unless the user asks for edits.
- Delete bodies only when the user deletes the note or explicitly requests it.

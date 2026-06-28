---
type: TinyCloud KV
title: KV
description: Delegated storage probe values.
tinycloud:
  app: xyz.tinycloud.app-starter
  service: kv
  profile: tinycloud.app.v1
  sensitivity: ephemeral
  containsSecretValue: false
---

# KV

## Probe

Prefix: `probe/`

Purpose: Store one small user-controlled value so the starter can verify
delegated TinyCloud KV access end to end.

Access:

| Capability | Why |
| --- | --- |
| `tinycloud.kv/get` | Read the probe value. |
| `tinycloud.kv/put` | Save the probe value. |
| `tinycloud.kv/del` | Clear the probe value. |
| `tinycloud.kv/list` | Support probe discovery and diagnostics. |

Agent notes:

- Probe data is disposable.
- Do not infer a durable product data model from this keyspace.

---
type: TinyCloud App
title: TinyCloud App Starter
description: Blank reusable TinyCloud app substrate with a delegated KV storage probe.
tinycloud:
  app: xyz.tinycloud.app-starter
  profile: tinycloud.app.v1
  containsSecretValue: false
---

# TinyCloud App Starter

TinyCloud App Starter demonstrates the smallest useful full-stack TinyCloud app:
browser sign-in, manifest-backed backend delegation, and one delegated KV probe.

## Resources

- [KV](kv.md) - Probe values under `probe/`.

## Runtime Contract

- `/api/manifest` serves the app manifest.
- `/api/server-info` serves backend delegation policy.
- The browser owns user sign-in and consent.
- The backend reads and writes user data only through delegated TinyCloud access.

## Agent Notes

- Treat this as the blank substrate for new apps, not as a product domain.
- Keep the probe data disposable.
- Do not add secret values to this knowledge bundle.

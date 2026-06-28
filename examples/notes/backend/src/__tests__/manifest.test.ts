import { describe, expect, it } from "bun:test";
import {
  APP_ID,
  NOTE_BODY_KV_PREFIX,
  NOTES_SQL_DATABASE_ID,
  backendDelegationPolicyHash,
  backendManifestConfig,
  backendDelegationResolvedPermissions,
  runtimeManifest,
} from "../manifest.js";

describe("TinyCloud Notes manifest and backend policy", () => {
  it("serves a v1 app/data manifest with explicit permissions only", () => {
    const manifest = runtimeManifest();

    expect(manifest.app_id).toBe("xyz.tinycloud.notes");
    expect(manifest.name).toBe("TinyCloud Notes");
    expect(manifest.knowledge).toBe(true);
    expect(manifest.defaults).toBe(false);
    expect("backend" in manifest).toBe(false);
    expect("delegations" in manifest).toBe(false);
    expect(manifest.permissions).toEqual([
      {
        service: "tinycloud.sql",
        path: "notes_index",
        actions: ["read", "write"],
        description: "Store note metadata including title, URL, tags, and body pointer.",
      },
      {
        service: "tinycloud.kv",
        path: "entries/",
        actions: ["get", "put", "del", "list"],
        description: "Store note body content by note id.",
      },
    ]);
  });

  it("derives and hashes backend policy from resolved runtime manifest permissions", () => {
    const backendDid = "did:key:z6MkBackend";
    const config = backendManifestConfig(backendDid);
    const resolved = backendDelegationResolvedPermissions(backendDid);

    expect(config.name).toBe("TinyCloud Notes Backend");
    expect(config.expiry).toBe("7d");
    expect(config.permissions).toHaveLength(2);
    expect(resolved.map((permission) => permission.path).sort()).toEqual([
      NOTE_BODY_KV_PREFIX,
      NOTES_SQL_DATABASE_ID,
    ]);
    expect(NOTES_SQL_DATABASE_ID).toBe(`${APP_ID}/notes_index`);
    expect(NOTE_BODY_KV_PREFIX).toBe(`${APP_ID}/entries/`);
    expect(backendDelegationPolicyHash(backendDid)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds the backend policy hash to the backend DID", () => {
    expect(backendDelegationPolicyHash("did:key:z6MkBackendA")).not.toBe(
      backendDelegationPolicyHash("did:key:z6MkBackendB"),
    );
  });
});

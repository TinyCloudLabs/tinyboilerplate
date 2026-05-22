import { describe, expect, it } from "bun:test";
import {
  APP_ID,
  PROBE_KV_PREFIX,
  backendDelegationPolicyHash,
  backendManifestConfig,
  backendDelegationResolvedPermissions,
  runtimeManifest,
} from "../manifest.js";

describe("TinyCloud App Starter manifest and backend policy", () => {
  it("serves a v1 app/data manifest with explicit permissions only", () => {
    const manifest = runtimeManifest();

    expect(manifest.manifest_version).toBe(1);
    expect(manifest.app_id).toBe(APP_ID);
    expect(manifest.name).toBe("TinyCloud App Starter");
    expect(manifest.defaults).toBe(false);
    expect("backend" in manifest).toBe(false);
    expect("delegations" in manifest).toBe(false);
    expect(manifest.permissions).toEqual([
      {
        service: "tinycloud.kv",
        path: "probe/",
        actions: ["get", "put", "del", "list"],
        description: "Read and write a tiny storage probe value.",
      },
    ]);
  });

  it("derives and hashes backend policy from resolved runtime manifest permissions", () => {
    const backendDid = "did:key:z6MkBackend";
    const config = backendManifestConfig(backendDid);
    const resolved = backendDelegationResolvedPermissions(backendDid);

    expect(config.name).toBe("TinyCloud App Starter Backend");
    expect(config.expiry).toBe("7d");
    expect(config.permissions).toHaveLength(1);
    expect(resolved.map((permission) => permission.path)).toEqual([PROBE_KV_PREFIX]);
    expect(PROBE_KV_PREFIX).toBe(`${APP_ID}/probe/`);
    expect(backendDelegationPolicyHash(backendDid)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds the backend policy hash to the backend DID", () => {
    expect(backendDelegationPolicyHash("did:key:z6MkBackendA")).not.toBe(
      backendDelegationPolicyHash("did:key:z6MkBackendB"),
    );
  });
});

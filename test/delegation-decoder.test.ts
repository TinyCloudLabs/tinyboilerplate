// Unit tests for the network-capture delegation decoder ported into
// test/real-auth-support.ts (TASK 3 / handoff §3 P4). The classifier is pure — no
// browser — so it is exercised here with REAL inputs for both branches (a signed
// UCAN JWT carrying an `att` capability map, and a bare CID) plus negatives.
//
// NOTE: this is a SEPARATE test file on purpose. test/real-auth-support.test.ts is
// CI-locked (it forbids a fixture-replay workflow; commits e3e2078 / 188a07f) and
// must never be modified, so the new decoder coverage lives here.
import { describe, expect, it } from "bun:test";

import {
  b64urlDecode,
  classifyDelegationAuthorization,
  createPersistenceMarker,
} from "./real-auth-support.ts";

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

// A realistic signed-UCAN-shaped compact JWS: header.payload.signature. The
// classifier does not verify the signature — it decodes the payload and keys off
// the `att` capability map, exactly as the node's delegated invokes carry it.
function makeSignedUcan(att: Record<string, unknown>, exp = 1893456000): string {
  const header = b64url({ alg: "EdDSA", typ: "JWT" });
  const payload = b64url({
    iss: "did:key:z6MkExampleIssuer",
    aud: "did:key:z6MkExampleAudience",
    att,
    exp,
  });
  const signature = Buffer.from("not-a-real-signature").toString("base64url");
  return `${header}.${payload}.${signature}`;
}

describe("b64urlDecode", () => {
  it("round-trips base64url (padding-tolerant) back to UTF-8", () => {
    const original = JSON.stringify({ att: { "tinycloud.sql/*": [{}] }, exp: 42 });
    const encoded = Buffer.from(original).toString("base64url");
    expect(b64urlDecode(encoded)).toBe(original);
  });
});

describe("classifyDelegationAuthorization", () => {
  it("classifies a signed UCAN JWT and extracts its att resources + exp", () => {
    const token = makeSignedUcan({ "tinycloud.sql/*": [{}], "tinycloud.kv/*": [{}] }, 1893456000);
    const info = classifyDelegationAuthorization(token);
    expect(info.kind).toBe("signed-ucan-jwt");
    expect(info.attResources).toEqual(["tinycloud.kv/*", "tinycloud.sql/*"]); // sorted
    expect(info.expiresAt).toBe(1893456000);
    expect(info.token).toBe(token);
  });

  it("strips a Bearer prefix before classifying", () => {
    const token = makeSignedUcan({ "tinycloud.capabilities/read": [{}] });
    const info = classifyDelegationAuthorization(`Bearer ${token}`);
    expect(info.kind).toBe("signed-ucan-jwt");
    expect(info.attResources).toEqual(["tinycloud.capabilities/read"]);
    expect(info.token).toBe(token); // Bearer removed
  });

  it("classifies a bare CID (opaque reference, not self-describing) as bare-cid", () => {
    // A real-looking IPFS CIDv1 — no dots, does not start with eyJ.
    const cid = "bafyreib2rxk3rw6w4v3fjq5m7x2t7z5k2q3s6d5f7g8h9j0k1l2m3n4o5p";
    const info = classifyDelegationAuthorization(cid);
    expect(info.kind).toBe("bare-cid");
    expect(info.attResources).toEqual([]);
    expect(info.expiresAt).toBeNull();
    expect(info.token).toBe(cid);
  });

  it("treats a JWT-shaped token with no att map as bare-cid (not a delegation)", () => {
    const noAtt = `${b64url({ alg: "EdDSA", typ: "JWT" })}.${b64url({ iss: "x", exp: 1 })}.sig`;
    const info = classifyDelegationAuthorization(noAtt);
    expect(info.kind).toBe("bare-cid");
    expect(info.attResources).toEqual([]);
  });

  it("treats a JWT-like token with an undecodable payload as bare-cid", () => {
    const info = classifyDelegationAuthorization("eyJhbGc.@@@not-base64@@@.sig");
    expect(info.kind).toBe("bare-cid");
  });

  it("returns missing for undefined / null / empty (negative case)", () => {
    for (const bad of [undefined, null, "", "   ", "Bearer "]) {
      const info = classifyDelegationAuthorization(bad);
      expect(info.kind).toBe("missing");
      expect(info.token).toBeNull();
    }
  });
});

describe("createPersistenceMarker", () => {
  it("produces unique, prefixed markers even in the same millisecond", () => {
    const a = createPersistenceMarker();
    const b = createPersistenceMarker();
    expect(a).not.toBe(b);
    expect(a.startsWith("e2e-")).toBe(true);
    expect(createPersistenceMarker("tasks").startsWith("tasks-")).toBe(true);
  });
});

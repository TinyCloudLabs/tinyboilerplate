/**
 * `verifyRenewal`: the checks behind `POST /api/auth/verify-renewal`. Real owner signatures (viem), real session keys
 * and SIWE CACAOs (node-sdk WASM), real leases, and a loopback stand-in node: an HTTP server on 127.0.0.1 that
 * verifies the relayed compact status invocation and answers with renewal stamps signed by a generated Ed25519
 * renewer key, in the `tinycloud/node/renewal-stamp/v1` format sdk-core's `verifyRenewalHistory` accepts. The client
 * half is the real `renewalVerifyProof`. Adapted from TinyChat's `auth-verify-renewal.test.ts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createPrivateKey, randomBytes, sign as signEd25519 } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { NodeWasmBindings } from "@tinycloud/node-sdk";
import {
  parseCompactUcanAuthorization,
  signCompactUcanRootAuthorization,
} from "@tinycloud/sdk-core";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { renewalVerifyProof } from "../src/auth.js";
import {
  renewalVerifyConfigFromEnv,
  verifyRenewal,
  type RenewalVerifyConfig,
  type RenewalVerifyInput,
} from "../../server/src/renewal-verify.js";

const BACKEND_ORIGIN = "https://api.renewal.test";
const HOUR = 3600;

// The stamp crypto is sdk-core's own (noble, multiformats): not backend dependencies, so it resolves
// from sdk-core's install at runtime, as the scripts/renewal harnesses do.
const sdkCorePath = createRequire(import.meta.path).resolve("@tinycloud/sdk-core");
const coreRequire = createRequire(sdkCorePath);
const { ed25519 } = await import(coreRequire.resolve("@noble/curves/ed25519"));
const { blake3 } = await import(coreRequire.resolve("@noble/hashes/blake3"));
const multiformats = join(dirname(sdkCorePath), "../../../multiformats/dist/src");
const { bases } = await import(join(multiformats, "basics.js"));
const { CID } = await import(join(multiformats, "cid.js"));
const { create: createDigest } = await import(join(multiformats, "hashes/digest.js"));

const wasm = new NodeWasmBindings();
const nowSeconds = () => Math.floor(Date.now() / 1000);
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const didKey = (seed: Uint8Array) =>
  `did:key:${bases.base58btc.encode(Uint8Array.from([0xed, 1, ...ed25519.getPublicKey(seed)]))}`;
const rawCid = (text: string) =>
  CID.createV1(0x55, createDigest(0x1e, blake3(Buffer.from(text)))).toString();

/** Minimal canonical DAG-CBOR for the stamp map: strings, small integers, maps (scripts/renewal harness). */
function encodeDagCbor(value: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  };
  if (typeof value === "string") {
    const b = Buffer.from(value);
    return Buffer.concat([head(3, b.length), b]);
  }
  if (typeof value === "number") return head(0, value);
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, val]) => [encodeDagCbor(key), encodeDagCbor(val)])
    .sort((a, b) => a[0].length - b[0].length || Buffer.compare(a[0], b[0]));
  return Buffer.concat([head(5, entries.length), ...entries.flat()]);
}

// ── Owner, session key, grant and lease ─────────────────────────────

interface Grant {
  account: PrivateKeyAccount;
  address: string;
  spaceId: string;
  siwe: string;
  signature: string;
  delegationCid: string;
  sessionDid: string;
  signSessionBytes: (bytes: Uint8Array) => Promise<Uint8Array>;
}

function sessionSigner(jwk: object) {
  const key = createPrivateKey({ key: jwk as never, format: "jwk" });
  return async (bytes: Uint8Array) => new Uint8Array(signEd25519(null, bytes, key));
}

/** An owner-signed session grant whose signed end has already passed. */
async function expiredGrant(account = privateKeyToAccount(generatePrivateKey())): Promise<Grant> {
  const manager = wasm.createSessionManager();
  const jwk = JSON.parse(manager.jwk("default"));
  const address = account.address;
  const spaceId = wasm.makeSpaceId(address, 1, "default");
  const now = nowSeconds();
  const prepared = wasm.prepareSession({
    abilities: {
      kv: { "xyz.tinycloud.tinychat/connectors/": ["tinycloud.kv/get", "tinycloud.kv/list"] },
    },
    address,
    chainId: 1,
    domain: "localhost",
    issuedAt: iso(now - 2 * HOUR),
    expirationTime: iso(now - 60),
    spaceId,
    jwk,
  });
  const signature = await account.signMessage({ message: prepared.siwe });
  const session = wasm.completeSessionSetup({ ...prepared, signature });
  return {
    account,
    address,
    spaceId,
    siwe: prepared.siwe,
    signature,
    delegationCid: session.delegationCid,
    sessionDid: manager.getDID("default"),
    signSessionBytes: sessionSigner(jwk),
  };
}

interface Lease {
  authorization: string;
  cid: string;
  expiresAt: number;
}

/** An owner-signed lease, as OpenKey signs one: `rawAbilities` only, audience the renewer. */
async function signLease(
  grant: Grant,
  options: {
    signer?: PrivateKeyAccount;
    audience?: string;
    rawAbilities?: Record<string, string[]>;
    expiresAt?: number;
    /** ReCap proofs (`prf`) to sign into the lease; OpenKey's leases carry none. */
    proofs?: string[];
  } = {},
): Promise<Lease> {
  const signer = options.signer ?? grant.account;
  const now = nowSeconds();
  const expiresAt = options.expiresAt ?? now + 30 * 24 * HOUR;
  const prepared = wasm.prepareSession({
    abilities: {},
    rawAbilities: options.rawAbilities ?? {
      [`urn:cid:${grant.delegationCid}`]: ["tinycloud.delegation/renew"],
    },
    address: wasm.ensureEip55(signer.address),
    chainId: 1,
    domain: "localhost",
    spaceId: wasm.makeSpaceId(signer.address, 1, "default"),
    delegateUri: options.audience ?? node.identity.renewerDid,
    issuedAt: iso(now - 3 * HOUR),
    expirationTime: iso(expiresAt),
  });
  const siwe = options.proofs ? withReCapProofs(prepared.siwe, options.proofs) : prepared.siwe;
  const signature = await signer.signMessage({ message: siwe });
  const session = wasm.completeSessionSetup({ ...prepared, siwe, signature });
  return {
    authorization: session.delegationHeader.Authorization,
    cid: session.delegationCid,
    expiresAt,
  };
}

/** `siwe` with its ReCap resource's `prf` set to `proofs`. */
function withReCapProofs(siwe: string, proofs: string[]): string {
  return siwe.replace(/urn:recap:([A-Za-z0-9_-]+)/, (_, encoded: string) => {
    const recap = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return `urn:recap:${Buffer.from(JSON.stringify({ ...recap, prf: proofs })).toString("base64url")}`;
  });
}

// ── Loopback stand-in node ──────────────────────────────────────────

const renewerSeed = randomBytes(32);
const nodeSeed = randomBytes(32);

const node = {
  server: undefined as ReturnType<typeof Bun.serve> | undefined,
  origin: "",
  identity: {
    nodeDid: didKey(nodeSeed),
    renewerDid: didKey(renewerSeed),
    renewerPublicKey: Buffer.from(ed25519.getPublicKey(renewerSeed)).toString("base64url"),
    renewerEpoch: 1,
  },
  /** Live status the node reports for `cid`. */
  state: {
    cid: "",
    active: true,
    revoked: false,
    effectiveExpiry: 0,
    history: [] as unknown[],
    statusCode: 200,
  },
  keysCalls: 0,
  statusCalls: 0,
};

function stamp(input: {
  originalCid: string;
  lease: Lease;
  newEnd: number;
  renewerEpoch?: number;
  nodeDid?: string;
}) {
  const bytes = encodeDagCbor({
    domain: "tinycloud/node/renewal-stamp/v1",
    unsigned: {
      type: "TinyCloudRenewalStamp",
      newEnd: iso(input.newEnd).replace(".000Z", "Z"),
      nodeDid: input.nodeDid ?? node.identity.nodeDid,
      version: 1,
      leaseCid: input.lease.cid,
      originalCid: input.originalCid,
      renewerEpoch: input.renewerEpoch ?? 1,
      leaseGeneration: 1,
      previousStampCid: input.lease.cid,
    },
  });
  return {
    cid: CID.createV1(0x55, createDigest(0x1e, blake3(bytes))).toString(),
    lease_cid: input.lease.cid,
    generation: 1,
    previous_stamp_cid: input.lease.cid,
    new_end: input.newEnd,
    signed_bytes: Buffer.from(bytes).toString("base64url"),
    signature: Buffer.from(ed25519.sign(bytes, renewerSeed)).toString("base64url"),
  };
}

function startNode(port = 0) {
  node.server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/.well-known/tinycloud/node-keys") {
        node.keysCalls++;
        return Response.json(node.identity);
      }
      if (request.method === "POST" && url.pathname === "/delegation/status") {
        node.statusCalls++;
        const { cid }: { cid: string } = await request.json();
        // As the real node: a verifiable invocation bound to exactly this CID's status, addressed to this node.
        let payload;
        try {
          payload = parseCompactUcanAuthorization(
            request.headers.get("authorization") ?? "",
          ).payload;
        } catch {
          return new Response("Invalid status invocation", { status: 401 });
        }
        const abilities = payload.att[`urn:cid:${cid}`];
        if (
          Object.keys(payload.att).length !== 1 ||
          !abilities?.["tinycloud.delegation/status"] ||
          payload.aud !== node.identity.nodeDid ||
          payload.exp <= nowSeconds()
        ) {
          return new Response("Status invocation is not bound to the requested CID", {
            status: 403,
          });
        }
        if (node.state.statusCode !== 200)
          return new Response("Status unavailable", { status: node.state.statusCode });
        if (cid !== node.state.cid) return Response.json({ cid, exists: false }, { status: 404 });
        return Response.json({
          cid,
          status: node.state.active ? "active" : "revoked",
          exists: true,
          active: node.state.active,
          revoked: node.state.revoked,
          expired: false,
          effective_expiry: node.state.effectiveExpiry,
          renewal_history: node.state.history,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  node.origin = `http://127.0.0.1:${node.server.port}`;
}

beforeAll(() => startNode());
afterAll(() => node.server?.stop(true));
afterEach(() => {
  node.identity.renewerEpoch = 1;
  node.state.statusCode = 200;
});

// ── Verifier under test ─────────────────────────────────────────────

function renewalConfig(overrides: Partial<RenewalVerifyConfig> = {}): RenewalVerifyConfig {
  return {
    backendOrigin: BACKEND_ORIGIN,
    nodeOrigin: node.origin,
    nodeDid: node.identity.nodeDid,
    frontendUrl: "http://localhost",
    renewerDid: node.identity.renewerDid,
    ...overrides,
  };
}

type Body = RenewalVerifyInput;

const verify = (body: Body, config = renewalConfig()) => verifyRenewal(body, { config });

/** What the lease-restored session holds: its saved record and the session key's signing surface. */
function restoredSession(grant: Grant) {
  return {
    tcw: {
      sessionDid: grant.sessionDid,
      signSessionBytes: grant.signSessionBytes,
      activeNodeIdentity: async () => ({ origin: node.origin, nodeDid: node.identity.nodeDid }),
    },
    record: {
      address: grant.address,
      siwe: grant.siwe,
      signature: grant.signature,
      tinycloudSession: { delegationCid: grant.delegationCid },
    } as never,
  };
}

let nonceCount = 0;
const freshNonce = () => `nonce-${++nonceCount}-${randomBytes(6).toString("hex")}`;

async function requestBody(
  grant: Grant,
  lease: Lease,
  address = grant.address,
  backendOrigin = BACKEND_ORIGIN,
): Promise<Body> {
  const nonce = freshNonce();
  const proof = await renewalVerifyProof({ ...restoredSession(grant), backendOrigin, nonce });
  return { address, nonce, leaseAuthorization: lease.authorization, ...proof };
}

/** The node holds `grant`, renewed by `lease` until `newEnd`. */
function nodeRenews(
  grant: Grant,
  lease: Lease,
  newEnd: number,
  history = [stamp({ originalCid: grant.delegationCid, lease, newEnd })],
) {
  node.state = {
    cid: grant.delegationCid,
    active: true,
    revoked: false,
    effectiveExpiry: newEnd,
    history,
    statusCode: 200,
  };
}

const nodeCalls = () => node.keysCalls + node.statusCalls;

let grant: Grant;
let lease: Lease;
beforeAll(async () => {
  grant = await expiredGrant();
  lease = await signLease(grant);
});

describe("verifyRenewal", () => {
  test("after the original's signed end, a live renewal is accepted and the token is bounded by the renewed end", async () => {
    const newEnd = nowSeconds() + 2 * HOUR;
    nodeRenews(grant, lease, newEnd);
    expect(await verify(await requestBody(grant, lease))).toEqual({
      ok: true,
      effectiveEnd: newEnd,
      notAfter: newEnd,
    });
  });

  test("a renewal longer than a day is bounded by one day", async () => {
    const newEnd = nowSeconds() + 3 * 24 * HOUR;
    nodeRenews(grant, lease, newEnd);
    const result = await verify(await requestBody(grant, lease));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveEnd).toBe(newEnd);
      expect(Math.abs(result.notAfter - (nowSeconds() + 24 * HOUR))).toBeLessThanOrEqual(2);
    }
  });

  /** Each refusal never reaches the node. */
  async function refusedBeforeNode(body: Body, code: string) {
    nodeRenews(grant, lease, nowSeconds() + HOUR);
    const calls = nodeCalls();
    expect(await verify(body)).toEqual({ ok: false, status: 401, code });
    expect(nodeCalls()).toBe(calls);
  }

  test("a grant signed by another owner than the address is refused", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    await refusedBeforeNode(await requestBody(grant, lease, other.address), "wrong_owner");
  });

  test("a grant the owner gave another app is refused, and one for this app's host passes that check", async () => {
    const body = await requestBody(grant, lease);
    nodeRenews(grant, lease, nowSeconds() + HOUR);
    const calls = nodeCalls();
    expect(
      await verify(body, renewalConfig({ frontendUrl: "https://other-app.example.org" })),
    ).toEqual({ ok: false, status: 401, code: "invalid_origin" });
    expect(nodeCalls()).toBe(calls);
    expect((await verify(body, renewalConfig({ frontendUrl: "http://localhost" }))).ok).toBe(true);
  });

  test("a lease signed by another owner is refused", async () => {
    const foreign = await signLease(grant, { signer: privateKeyToAccount(generatePrivateKey()) });
    await refusedBeforeNode(await requestBody(grant, foreign), "lease_wrong_owner");
  });

  test("a lease to another audience than the pinned renewer is refused", async () => {
    const wrongAudience = await signLease(grant, { audience: didKey(randomBytes(32)) });
    await refusedBeforeNode(await requestBody(grant, wrongAudience), "lease_wrong_audience");
  });

  test("a lease with an extra capability is refused", async () => {
    const extra = await signLease(grant, {
      rawAbilities: {
        [`urn:cid:${grant.delegationCid}`]: [
          "tinycloud.delegation/renew",
          "tinycloud.delegation/status",
        ],
      },
    });
    await refusedBeforeNode(await requestBody(grant, extra), "lease_wrong_scope");
  });

  test("a lease for another delegation CID is refused", async () => {
    const elsewhere = await signLease(grant, {
      rawAbilities: { [`urn:cid:${rawCid("another-grant")}`]: ["tinycloud.delegation/renew"] },
    });
    await refusedBeforeNode(await requestBody(grant, elsewhere), "lease_wrong_scope");
  });

  test("a lease that carries a proof is refused", async () => {
    const proved = await signLease(grant, { proofs: [rawCid("a-parent-grant")] });
    await refusedBeforeNode(await requestBody(grant, proved), "lease_wrong_scope");
  });

  test("a lapsed lease is refused", async () => {
    const lapsed = await signLease(grant, { expiresAt: nowSeconds() - 60 });
    await refusedBeforeNode(await requestBody(grant, lapsed), "lease_expired");
  });

  test("a holder proof from another key is refused", async () => {
    const body = await requestBody(grant, lease);
    const message = `tinyboilerplate-renewal-verify|${BACKEND_ORIGIN}|${grant.address.toLowerCase()}|${grant.delegationCid}|${body.nonce}`;
    body.holderProof = Buffer.from(ed25519.sign(Buffer.from(message), randomBytes(32))).toString(
      "base64url",
    );
    await refusedBeforeNode(body, "invalid_holder_proof");
  });

  test("a holder proof for another backend origin is refused", async () => {
    await refusedBeforeNode(
      await requestBody(grant, lease, grant.address, "https://elsewhere.test"),
      "invalid_holder_proof",
    );
  });

  test("a delegation CID that is not the presented grant's is refused", async () => {
    const other = await expiredGrant(grant.account);
    const body = await requestBody(grant, lease);
    body.delegation = { ...body.delegation, delegationCid: other.delegationCid };
    await refusedBeforeNode(body, "grant_cid_mismatch");
  });

  test("a status invocation replayed after its expiry is refused without calling the node", async () => {
    const body = await requestBody(grant, lease);
    const past = nowSeconds() - 120;
    body.statusInvocation = (
      await signCompactUcanRootAuthorization({
        issuerDid: grant.sessionDid,
        audienceDid: node.identity.nodeDid,
        attenuation: {
          [`urn:cid:${grant.delegationCid}`]: { "tinycloud.delegation/status": [{}] },
        },
        facts: [{}],
        proofs: [],
        notBefore: past,
        expiresAt: past + 60,
        nonce: body.nonce,
        sign: grant.signSessionBytes,
      })
    ).authorization;
    await refusedBeforeNode(body, "invalid_status_invocation");
  });

  test("a status invocation addressed to another node is refused without calling the node", async () => {
    const body = await requestBody(grant, lease);
    const now = nowSeconds();
    body.statusInvocation = (
      await signCompactUcanRootAuthorization({
        issuerDid: grant.sessionDid,
        audienceDid: didKey(randomBytes(32)),
        attenuation: {
          [`urn:cid:${grant.delegationCid}`]: { "tinycloud.delegation/status": [{}] },
        },
        facts: [{}],
        proofs: [],
        notBefore: now,
        expiresAt: now + 60,
        nonce: body.nonce,
        sign: grant.signSessionBytes,
      })
    ).authorization;
    await refusedBeforeNode(body, "invalid_status_invocation");
  });

  /** Refusals the live node check produces: the node was asked. */
  async function refusedByNode(code: string, arrange: () => void, expected: 401 | 503 = 401) {
    nodeRenews(grant, lease, nowSeconds() + HOUR);
    arrange();
    expect(await verify(await requestBody(grant, lease))).toEqual({
      ok: false,
      status: expected,
      code,
    });
  }

  test("a validly signed history for a different delegation is refused", async () => {
    await refusedByNode("renewal_history_invalid", () => {
      node.state.history = [
        stamp({ originalCid: rawCid("another-original"), lease, newEnd: nowSeconds() + HOUR }),
      ];
    });
  });

  test("a revoked delegation is refused", async () => {
    await refusedByNode("renewal_inactive", () => {
      node.state.active = false;
      node.state.revoked = true;
    });
  });

  test("a delegation the node does not hold is refused", async () => {
    await refusedByNode("renewal_inactive", () => {
      node.state.cid = rawCid("not-this-one");
    });
  });

  test("a lapsed renewal stamp is refused", async () => {
    await refusedByNode("renewal_history_invalid", () => {
      const lapsed = nowSeconds() - 30;
      node.state.effectiveExpiry = lapsed;
      node.state.history = [stamp({ originalCid: grant.delegationCid, lease, newEnd: lapsed })];
    });
  });

  test("a renewer epoch change is refused", async () => {
    await refusedByNode("renewal_history_invalid", () => {
      node.identity.renewerEpoch = 2;
    });
  });

  test("a node error answers 503", async () => {
    await refusedByNode(
      "node_unavailable",
      () => {
        node.state.statusCode = 500;
      },
      503,
    );
  });

  test("an unreachable node answers 503", async () => {
    nodeRenews(grant, lease, nowSeconds() + HOUR);
    expect(
      await verify(
        await requestBody(grant, lease),
        renewalConfig({ nodeOrigin: "http://127.0.0.1:9" }),
      ),
    ).toEqual({
      ok: false,
      status: 503,
      code: "node_unavailable",
    });
  });
});

describe("renewalVerifyConfigFromEnv", () => {
  const dids = {
    RENEWAL_NODE_DID: node.identity.nodeDid,
    RENEWAL_RENEWER_DID: node.identity.renewerDid,
  };

  test("is off without settings and refuses a partial set", () => {
    expect(
      renewalVerifyConfigFromEnv({}, "https://node.tinycloud.xyz", "https://app.example.com"),
    ).toBeUndefined();
    expect(() =>
      renewalVerifyConfigFromEnv(
        { RENEWAL_NODE_DID: dids.RENEWAL_NODE_DID },
        "https://node.tinycloud.xyz",
        "https://app.example.com",
      ),
    ).toThrow("set together");
  });

  test("pins the node to the node host and allows loopback http only outside production", () => {
    const env = { ...dids, RENEWAL_BACKEND_ORIGIN: "https://api.example.com" };
    expect(
      renewalVerifyConfigFromEnv(
        { ...env, NODE_ENV: "production" },
        "https://tee.node.tinycloud.xyz",
        "https://app.example.com",
      ),
    ).toEqual({
      backendOrigin: "https://api.example.com",
      nodeOrigin: "https://tee.node.tinycloud.xyz",
      nodeDid: dids.RENEWAL_NODE_DID,
      frontendUrl: "https://app.example.com",
      renewerDid: dids.RENEWAL_RENEWER_DID,
    });
    expect(
      renewalVerifyConfigFromEnv(
        { ...env, NODE_ENV: "development" },
        "http://127.0.0.1:8000",
        "https://app.example.com",
      )?.nodeOrigin,
    ).toBe("http://127.0.0.1:8000");
    expect(() =>
      renewalVerifyConfigFromEnv(
        { ...env, NODE_ENV: "production" },
        "http://127.0.0.1:8000",
        "https://app.example.com",
      ),
    ).toThrow("https origin");
  });
});

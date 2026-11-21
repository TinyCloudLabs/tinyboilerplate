import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { TinyCloudWeb, type PersistedSessionData } from "@tinycloud/web-sdk";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { openKeyRenewalClient } from "../src/openkey.js";
import {
  SIGN_IN_RENEWAL_ASK,
  admitSignInRenewal,
  keptLeaseEnd,
  renewalRestoreFor,
  verifiedRenewalLease,
} from "../src/renewal.js";
import {
  clearPersistedSession,
  loadRenewalReceipt,
  saveRenewalReceipt,
} from "../src/session-persistence.js";
import { restoreTinyCloudWebSession } from "../src/tinycloud.js";
import { OTHER_RENEWER, fixture, iso, originalEnd } from "./renewal.fixture.js";

// The renewing sign-in, with real wallet-signed SIWE CACAOs (renewal.fixture.ts), the real web-sdk admission against a
// loopback stand-in for the session's node, and the saved-session reads. Runs in its own bun process (`bun test ./test`),
// like openkey-signin.test.ts, because src/__tests__ mocks web-sdk for the whole process. Adapted from TinyChat's
// renewalAdmission and renewalReceipt tests.

function installLocalStorage() {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size;
    },
  } as Storage;
}

let node: ReturnType<typeof Bun.serve>;
let published: unknown;
let delegateStatus: number | "hang";
let presented: string[];

beforeEach(() => {
  installLocalStorage();
  presented = [];
  delegateStatus = 200;
  node = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method === "GET" && pathname === "/.well-known/tinycloud/node-keys")
        return Response.json(published);
      if (request.method === "POST" && pathname === "/delegate") {
        presented.push(request.headers.get("Authorization") ?? "");
        if (delegateStatus === "hang") return new Promise<Response>(() => {});
        return Response.json({ activated: [], skipped: [] }, { status: delegateStatus });
      }
      return new Response("unexpected", { status: 500 });
    },
  });
});

afterEach(() => node.stop(true));

function admit(
  address: string,
  record: PersistedSessionData,
  renewal: unknown,
  load = async () => record as PersistedSessionData | null,
  arrivedAt: number | undefined = performance.now(),
) {
  return admitSignInRenewal({
    tcw: {
      activeNodeIdentity: async () => ({
        origin: `http://127.0.0.1:${node.port}`,
        nodeDid: "did:key:node",
      }),
    },
    address,
    renewal,
    arrivedAt,
    storage: { load },
  });
}

function publish(receipt: Receipt) {
  published = receipt.receipt.nodeIdentity;
}

type Receipt = Awaited<ReturnType<typeof fixture>>["receipt"];

describe("renewal chosen at sign-in", () => {
  test("is admitted at the session's node with the lease OpenKey signed, then kept as the session's receipt", async () => {
    const { owner, record, receipt, lease } = await fixture();
    publish(receipt);
    expect(await admit(owner.address, record, receipt)).toBe(true);
    expect(presented).toEqual([lease.authorization]);
    expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
  });

  test("is not kept when the session was signed out while the node admitted it", async () => {
    const { owner, record, receipt } = await fixture();
    publish(receipt);
    expect(
      await admit(owner.address, record, receipt, async () =>
        presented.length === 0 ? record : null,
      ),
    ).toBe(false);
    expect(presented).toHaveLength(1);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  test("is not kept when the node refuses the lease, so the session runs to its signed end", async () => {
    const { owner, record, receipt } = await fixture();
    publish(receipt);
    delegateStatus = 403;
    expect(await admit(owner.address, record, receipt)).toBe(false);
    expect(presented).toHaveLength(1);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  test("is given up after five seconds when the node doesn't answer, and not kept", async () => {
    const { owner, record, receipt } = await fixture();
    publish(receipt);
    delegateStatus = "hang";
    const started = Date.now();
    expect(await admit(owner.address, record, receipt)).toBe(false);
    expect(Date.now() - started).toBeLessThan(7_000);
    expect(presented).toHaveLength(1);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  }, 10_000);

  test("is not sent when the node's renewer is no longer the one the lease names", async () => {
    const { owner, record, receipt } = await fixture();
    publish(receipt);
    published = { ...receipt.receipt.nodeIdentity, renewerEpoch: 1 };
    expect(await admit(owner.address, record, receipt)).toBe(false);
    expect(presented).toEqual([]);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  test("is not sent when the lease doesn't check out against the session just signed in", async () => {
    const { owner, record, receipt } = await fixture({
      leaseSigner: privateKeyToAccount(generatePrivateKey()),
    });
    publish(receipt);
    expect(await admit(owner.address, record, receipt)).toBe(false);
    const other = await fixture();
    expect(await admit(owner.address, record, other.receipt)).toBe(false);
    expect(presented).toEqual([]);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  test("absent (renewal unticked, or an OpenKey without it) contacts no node and keeps nothing", async () => {
    const { owner, record } = await fixture();
    expect(await admit(owner.address, record, undefined)).toBe(false);
    expect(presented).toEqual([]);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  test("is not sent once a minute has passed since it arrived, and not kept", async () => {
    const { owner, record, receipt } = await fixture();
    publish(receipt);
    expect(await admit(owner.address, record, receipt, undefined, performance.now() - 60_001)).toBe(
      false,
    );
    // No arrival time (the outcome never came through the sign-in client): not sent.
    expect(
      await admitSignInRenewal({
        tcw: {
          activeNodeIdentity: async () => ({
            origin: `http://127.0.0.1:${node.port}`,
            nodeDid: "did:key:node",
          }),
        },
        address: owner.address,
        renewal: receipt,
        arrivedAt: undefined,
        storage: { load: async () => record },
      }),
    ).toBe(false);
    expect(presented).toEqual([]);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  test("is given up when its minute runs out, even with the five seconds not yet up", async () => {
    const { owner, record, receipt } = await fixture();
    publish(receipt);
    delegateStatus = "hang";
    const started = performance.now();
    expect(await admit(owner.address, record, receipt, undefined, started - 59_000)).toBe(false);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(presented).toHaveLength(1);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  }, 10_000);

  test("counts its minute from arrival on this device, not from when OpenKey approved it by the wall clock", async () => {
    const { owner, record, receipt } = await fixture();
    publish(receipt);
    // This device's wall clock runs two minutes past OpenKey's `approvedAt`; the lease has only just arrived.
    const wallClock = Date.now;
    Date.now = () => wallClock() + 120_000;
    try {
      expect(await admit(owner.address, record, receipt)).toBe(true);
    } finally {
      Date.now = wallClock;
    }
    expect(presented).toHaveLength(1);
  });
});

describe("a stored renewal receipt", () => {
  test("for the saved grant, signed by its owner for that grant's renewal alone, yields the lease", async () => {
    const { record, receipt, lease } = await fixture();
    expect(await verifiedRenewalLease(receipt, record)).toBe(lease.authorization);
  });

  test("naming another grant is not used", async () => {
    const { record, receipt } = await fixture();
    const other = await fixture();
    expect(await verifiedRenewalLease(other.receipt, record)).toBeNull();
    expect(
      await verifiedRenewalLease(
        {
          ...receipt,
          receipt: {
            ...receipt.receipt,
            originalCid: other.record.tinycloudSession!.delegationCid,
          },
        },
        record,
      ),
    ).toBeNull();
  });

  test("whose lease another wallet signed is not used", async () => {
    const { record, receipt } = await fixture({
      leaseSigner: privateKeyToAccount(generatePrivateKey()),
    });
    expect(await verifiedRenewalLease(receipt, record)).toBeNull();
  });

  test("for a grant whose owner is not the saved session's account is not used", async () => {
    const { record, receipt } = await fixture();
    const someoneElse = privateKeyToAccount(generatePrivateKey()).address;
    expect(await verifiedRenewalLease(receipt, { ...record, address: someoneElse })).toBeNull();
  });

  test("whose lease grants more than renewing that grant is not used", async () => {
    const { record, receipt } = await fixture({ extraAbility: true });
    expect(await verifiedRenewalLease(receipt, record)).toBeNull();
  });

  test("whose lease names a renewer other than the receipt's is not used", async () => {
    const { record, receipt } = await fixture({ leaseAudience: OTHER_RENEWER });
    expect(await verifiedRenewalLease(receipt, record)).toBeNull();
  });

  test("approved after the grant ended is not used", async () => {
    const late = iso(originalEnd + 1000);
    const { record, receipt } = await fixture({ approvedAt: late });
    expect(await verifiedRenewalLease({ ...receipt, approvedAt: late }, record)).toBeNull();
  });

  test("that is not a receipt at all is not used", async () => {
    const { record } = await fixture();
    expect(await verifiedRenewalLease({ version: 1 }, record)).toBeNull();
    expect(await verifiedRenewalLease(null, record)).toBeNull();
  });
});

describe("restoring through the lease", () => {
  beforeEach(installLocalStorage);

  function storage(
    status: "loaded" | "renewal-candidate" | "missing",
    record: PersistedSessionData,
    active?: string,
  ) {
    return {
      activeAddressForRenewal: () => active,
      loadRenewalCandidate: async () =>
        status === "missing" ? { status, data: null } : { status, data: record },
    } as Parameters<typeof renewalRestoreFor>[1];
  }

  test("happens only once the saved session is past its end and its receipt checks out", async () => {
    const { owner, record, receipt, lease } = await fixture();
    saveRenewalReceipt(owner.address, receipt);
    expect(await renewalRestoreFor(owner.address, storage("renewal-candidate", record))).toEqual({
      address: owner.address,
      leaseAuthorization: lease.authorization,
      record,
      pastSignedEnd: true,
    });
    // Before the signed end the lease only backs a reissued backend bearer: the plain restore loads the session.
    expect(await renewalRestoreFor(owner.address, storage("loaded", record))).toEqual({
      address: owner.address,
      leaseAuthorization: lease.authorization,
      record,
      pastSignedEnd: false,
    });
    expect(await renewalRestoreFor(owner.address, storage("missing", record))).toBeNull();
  });

  test("with the bearer gone, uses the account the SDK kept for renewal", async () => {
    const { owner, record, receipt, lease } = await fixture();
    saveRenewalReceipt(owner.address, receipt);
    expect(
      await renewalRestoreFor(null, storage("renewal-candidate", record, owner.address)),
    ).toMatchObject({ address: owner.address, leaseAuthorization: lease.authorization });
    expect(await renewalRestoreFor(null, storage("renewal-candidate", record))).toBeNull();
  });

  test("with no receipt stored (a finite sign-in) never happens", async () => {
    const { owner, record } = await fixture();
    expect(await renewalRestoreFor(owner.address, storage("renewal-candidate", record))).toBeNull();
  });

  test("never happens for a receipt that belongs to another saved session", async () => {
    const { owner, record } = await fixture();
    const other = await fixture();
    saveRenewalReceipt(owner.address, other.receipt);
    expect(await renewalRestoreFor(owner.address, storage("renewal-candidate", record))).toBeNull();
  });

  test("never happens once the session was cleared, which takes the receipt with it", async () => {
    const { owner, record, receipt } = await fixture();
    saveRenewalReceipt(owner.address, receipt);
    clearPersistedSession(owner.address);
    expect(await renewalRestoreFor(owner.address, storage("renewal-candidate", record))).toBeNull();
  });
});

describe("the sign-in client", () => {
  test("adds the renewal ask to OpenKey's request and reports what OpenKey returns about renewal", async () => {
    const seen: unknown[] = [];
    const result = { siwe: "signed", renewalChoice: { chosen: true }, renewal: { receipt: 1 } };
    const client = openKeyRenewalClient(
      { authorizeTinyCloud: async (request: unknown) => (seen.push(request), result) } as never,
      SIGN_IN_RENEWAL_ASK,
      (outcome) => seen.push(outcome),
    );
    expect(await client.authorizeTinyCloud({ siwe: "s" } as never, {} as never)).toBe(
      result as never,
    );
    expect(seen).toEqual([
      { siwe: "s", renewal: SIGN_IN_RENEWAL_ASK },
      { renewalChoice: { chosen: true }, renewal: { receipt: 1 } },
    ]);
  });

  test("an OpenKey that returns no renewal (flag off, or an SDK without it) leaves the sign-in finite", async () => {
    let outcome: unknown;
    const client = openKeyRenewalClient(
      { authorizeTinyCloud: async () => ({ siwe: "signed" }) } as never,
      SIGN_IN_RENEWAL_ASK,
      (value) => (outcome = value),
    );
    await client.authorizeTinyCloud({} as never, {} as never);
    expect(outcome).toEqual({ renewalChoice: undefined, renewal: undefined });
    const { owner, record } = await fixture();
    expect(await admit(owner.address, record, (outcome as { renewal?: unknown }).renewal)).toBe(
      false,
    );
    expect(presented).toEqual([]);
    expect(loadRenewalReceipt(owner.address)).toBeNull();
    expect(
      await keptLeaseEnd(owner.address, {
        loadRenewalCandidate: async () => ({ status: "loaded", data: record }),
      } as never),
    ).toBeNull();
  });
});

describe("reload through the lease", () => {
  const restored = { status: "missing", data: null };

  test("a lease past the signed end restores with it; without a lease the plain restore runs", async () => {
    const withRenewal = spyOn(
      TinyCloudWeb.prototype,
      "restoreSessionWithRenewal",
    ).mockResolvedValue(restored as never);
    const plain = spyOn(TinyCloudWeb.prototype, "restoreSession").mockResolvedValue(
      restored as never,
    );
    try {
      await restoreTinyCloudWebSession("0xabc", { renewalLeaseAuthorization: "lease-token" });
      expect(withRenewal.mock.calls).toEqual([["lease-token", "0xabc"]]);
      expect(plain).not.toHaveBeenCalled();
      await restoreTinyCloudWebSession("0xabc");
      expect(plain.mock.calls).toEqual([["0xabc"]]);
      expect(withRenewal).toHaveBeenCalledTimes(1);
    } finally {
      withRenewal.mockRestore();
      plain.mockRestore();
    }
  });

  test("a receipt kept at sign-in is the one the reload finds, with its end for display", async () => {
    const { owner, record, receipt, lease } = await fixture();
    publish(receipt);
    expect(await admit(owner.address, record, receipt)).toBe(true);
    const storage = {
      activeAddressForRenewal: () => owner.address,
      loadRenewalCandidate: async () => ({ status: "renewal-candidate", data: record }),
    } as never;
    expect(await renewalRestoreFor(null, storage)).toMatchObject({
      address: owner.address,
      leaseAuthorization: lease.authorization,
      pastSignedEnd: true,
    });
    expect(await keptLeaseEnd(owner.address, storage)).toBe(receipt.receipt.leaseExpiresAt);
    clearPersistedSession(owner.address);
    expect(await renewalRestoreFor(null, storage)).toBeNull();
  });
});

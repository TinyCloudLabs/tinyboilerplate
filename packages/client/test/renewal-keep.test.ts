import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { TinyCloudWeb } from "@tinycloud/web-sdk";

import { renewalRestoreFor, renewalRestoreVerdict, settleFailedRestore } from "../src/renewal.js";
import { loadRenewalReceipt, saveRenewalReceipt } from "../src/session-persistence.js";
import { restoreTinyCloudWebSession } from "../src/tinycloud.js";
import { fixture } from "./renewal.fixture.js";

// What a failed lease restore does to the saved session and its receipt. Own file and process (`bun test ./test`).

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

beforeEach(installLocalStorage);
afterEach(() => setSystemTime());

function candidateStorage(record: unknown) {
  return {
    activeAddressForRenewal: () => null,
    loadRenewalCandidate: async () => ({ status: "renewal-candidate", data: record }),
  } as Parameters<typeof renewalRestoreFor>[1];
}

describe("a failed restore through the lease", () => {
  async function restoreFailing(failure: unknown) {
    const restore = spyOn(TinyCloudWeb.prototype, "restoreSessionWithRenewal").mockRejectedValue(
      failure,
    );
    try {
      return await restoreTinyCloudWebSession("0xabc", {
        renewalLeaseAuthorization: "lease-token",
      });
    } finally {
      restore.mockRestore();
    }
  }

  test("keeps the receipt on a clearly transient failure: network, wrapped network, timeout, 408, 429, 5xx", async () => {
    const { owner, receipt } = await fixture();
    for (const failure of [
      new TypeError("fetch failed"),
      Object.assign(new Error("restore failed"), { cause: new TypeError("Failed to fetch") }),
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      Object.assign(new Error("aborted"), { name: "AbortError" }),
      Object.assign(new Error("HTTP 408"), { status: 408 }),
      Object.assign(new Error("slow down"), { status: 429 }),
      Object.assign(new Error("bad gateway"), { status: 503 }),
    ]) {
      saveRenewalReceipt(owner.address, receipt);
      const result = await restoreFailing(failure);
      expect(result.status).toBe("restore-failed");
      expect(settleFailedRestore(owner.address, result.status, result.error, false)).toBe("keep");
      expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
    }
  });

  test("keeps the receipt while the device is offline, whatever the error", async () => {
    const { owner, receipt } = await fixture();
    saveRenewalReceipt(owner.address, receipt);
    expect(settleFailedRestore(owner.address, "restore-failed", new Error("odd"), true)).toBe(
      "keep",
    );
    expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
  });

  test("drops the receipt on a 403 and keeps it on a 503", async () => {
    const { owner, receipt } = await fixture();
    saveRenewalReceipt(owner.address, receipt);
    const unavailable = await restoreFailing(Object.assign(new Error("HTTP 503"), { status: 503 }));
    expect(settleFailedRestore(owner.address, unavailable.status, unavailable.error, false)).toBe(
      "keep",
    );
    expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
    const refused = await restoreFailing(Object.assign(new Error("HTTP 403"), { status: 403 }));
    expect(settleFailedRestore(owner.address, refused.status, refused.error, false)).toBe("drop");
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  test("drops the receipt on an ended lease code, a 4xx and an error that is not recognisably transient", async () => {
    const { owner, receipt } = await fixture();
    for (const failure of [
      Object.assign(new Error("lease ended"), { code: "RENEWAL_LEASE_EXPIRED" }),
      Object.assign(new Error("original ended"), { code: "RENEWAL_LEASE_ORIGINAL_EXPIRED" }),
      Object.assign(new Error("authority"), { code: "RENEWAL_AUTHORITY_INACTIVE" }),
      Object.assign(new Error("not found"), { status: 404 }),
      new Error("something unexpected"),
    ]) {
      saveRenewalReceipt(owner.address, receipt);
      const result = await restoreFailing(failure);
      expect(settleFailedRestore(owner.address, result.status, result.error, false)).toBe("drop");
      expect(loadRenewalReceipt(owner.address)).toBeNull();
    }
  });

  test("drops the receipt on every status that is a verdict: expired, corrupt, stale, missing, storage-unavailable", async () => {
    const { owner, receipt } = await fixture();
    for (const status of ["expired", "corrupt", "stale", "missing", "storage-unavailable"]) {
      saveRenewalReceipt(owner.address, receipt);
      expect(renewalRestoreVerdict(status)).toBe("drop");
      expect(settleFailedRestore(owner.address, status)).toBe("drop");
      expect(loadRenewalReceipt(owner.address)).toBeNull();
    }
  });
});

describe("a receipt whose lease end has passed", () => {
  test("is dropped and the restore does not go through the lease", async () => {
    const { owner, record, receipt } = await fixture();
    saveRenewalReceipt(owner.address, receipt);
    expect(await renewalRestoreFor(owner.address, candidateStorage(record))).not.toBeNull();
    setSystemTime(new Date(Date.parse(receipt.receipt.leaseExpiresAt) + 1_000));
    expect(await renewalRestoreFor(owner.address, candidateStorage(record))).toBeNull();
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });
});

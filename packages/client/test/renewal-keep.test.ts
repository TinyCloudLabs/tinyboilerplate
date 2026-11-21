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
  test("keeps the receipt on a transient failure: network, timeout, 5xx, unreadable storage", async () => {
    const { owner, receipt } = await fixture();
    for (const failure of [
      new TypeError("fetch failed"),
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      Object.assign(new Error("HTTP 503"), { status: 503 }),
    ]) {
      saveRenewalReceipt(owner.address, receipt);
      const restore = spyOn(TinyCloudWeb.prototype, "restoreSessionWithRenewal").mockRejectedValue(
        failure,
      );
      try {
        const result = await restoreTinyCloudWebSession(owner.address, {
          renewalLeaseAuthorization: "lease-token",
        });
        expect(result.status).toBe("restore-failed");
        expect(settleFailedRestore(owner.address, result.status)).toBe("keep");
        expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
      } finally {
        restore.mockRestore();
      }
    }
    saveRenewalReceipt(owner.address, receipt);
    expect(settleFailedRestore(owner.address, "storage-unavailable")).toBe("keep");
    expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
  });

  test("keeps the receipt on an error that is not recognisably an answer", async () => {
    const { owner, receipt } = await fixture();
    saveRenewalReceipt(owner.address, receipt);
    const restore = spyOn(TinyCloudWeb.prototype, "restoreSessionWithRenewal").mockRejectedValue(
      new Error("something unexpected"),
    );
    try {
      const result = await restoreTinyCloudWebSession(owner.address, {
        renewalLeaseAuthorization: "lease-token",
      });
      expect(settleFailedRestore(owner.address, result.status)).toBe("keep");
      expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
    } finally {
      restore.mockRestore();
    }
  });

  test("drops the receipt on an expired, corrupt, stale or missing answer", async () => {
    const { owner, receipt } = await fixture();
    for (const status of ["expired", "corrupt", "stale", "missing"]) {
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

import { parseSignedSiweCacao, pkhDid, principalDidEquals } from "@tinycloud/sdk-core";
import { admitOwnerRenewalLease } from "@tinycloud/sdk-core/delegations/renewal";
import { parseApprovalRenewal, type ApprovalRenewal } from "@tinycloud/share-envelope/links";
import {
  BrowserSessionStorage,
  type PersistedSessionData,
  type TinyCloudWeb,
} from "@tinycloud/web-sdk";
import {
  clearPersistedSession,
  clearRenewalReceipt,
  loadRenewalReceipt,
  saveRenewalReceipt,
} from "./session-persistence.js";

// ── Renewal lease ────────────────────────────────────────────────────
//
// The lease OpenKey signs when the owner leaves renewal on at sign-in. OpenKey records it, so the owner's stops can
// revoke it, but does not send it to the node: right after sign-in the app checks it against the just-saved session
// record, has the session's node admit it, and only then keeps it beside the record as the session's receipt. It is
// trusted for nothing until it is checked against that exact record. The node stays the authority on whether the
// lease still renews: the SDK's renewal restore asks it before it restores anything.
// Adapted from TinyChat's frontend `renewalReceipt.ts`.

/** The 90-day renewal the template asks OpenKey to offer at sign-in. */
export const SIGN_IN_RENEWAL_ASK = {
  version: 1,
  leaseLifetimeSeconds: 90 * 24 * 60 * 60,
  purpose: "standing",
} as const;

const RENEW = "tinycloud.delegation/renew";

/**
 * The lease authorization in `value` when it is a well-formed receipt for `record`'s own grant, signed by the grant's
 * owner, for that grant only; otherwise null. Never throws.
 */
export async function verifiedRenewalLease(
  value: unknown,
  record: PersistedSessionData,
): Promise<string | null> {
  try {
    const renewal: ApprovalRenewal = parseApprovalRenewal(value);
    const { receipt } = renewal;
    const grant = record.tinycloudSession;
    if (!grant || receipt.originalCid !== grant.delegationCid) return null;
    const original = await parseSignedSiweCacao(
      grant.delegationHeader.Authorization.replace(/^Bearer\s+/i, ""),
      grant.delegationCid,
    );
    const lease = await parseSignedSiweCacao(receipt.leaseAuthorization, receipt.leaseCid);
    const target = lease.attenuation[`urn:cid:${grant.delegationCid}`];
    const caveats = target?.[RENEW];
    const originalEnd = Date.parse(original.expiresAt ?? "");
    if (
      !principalDidEquals(original.issuer, pkhDid(record.address, record.chainId)) ||
      !principalDidEquals(lease.issuer, original.issuer) ||
      lease.audience !== receipt.nodeIdentity.renewerDid ||
      lease.proofs.length !== 0 ||
      Object.keys(lease.attenuation).length !== 1 ||
      !target ||
      Object.keys(target).length !== 1 ||
      !Array.isArray(caveats) ||
      caveats.length !== 1 ||
      typeof caveats[0] !== "object" ||
      caveats[0] === null ||
      Object.keys(caveats[0]).length !== 0 ||
      Date.parse(lease.expiresAt ?? "") !== Date.parse(receipt.leaseExpiresAt) ||
      !Number.isFinite(originalEnd) ||
      Date.parse(renewal.approvedAt) >= originalEnd
    ) {
      return null;
    }
    return receipt.leaseAuthorization;
  } catch {
    return null;
  }
}

/** How long the sign-in waits for the node to admit the lease before going on without renewal. */
const ADMIT_TIMEOUT_MS = 5_000;
/**
 * The latest a lease is sent to the node, after it arrived on this device. A stop at OpenKey leaves a sign-in lease it
 * can't find at the node on for ten minutes, in case the app is still admitting it; this keeps every admission well
 * inside that. Measured on this device's monotonic clock, never against OpenKey's `approvedAt`.
 */
const ADMIT_DEADLINE_MS = 60_000;

/**
 * Has the signed-in session's node admit the lease OpenKey returned, then keeps it as the session's receipt. The lease
 * must first check out against the session record the sign-in just saved, and is sent only within a minute of
 * `arrivedAt` (a `performance.now()` reading taken when OpenKey returned it). Without a lease, or when the check, the
 * deadline or the admission fails, nothing is kept: the session lasts until its signed end. Resolves whether renewal
 * is now on.
 */
export async function admitSignInRenewal(input: {
  tcw: Pick<TinyCloudWeb, "activeNodeIdentity">;
  address: string;
  renewal: unknown;
  arrivedAt: number | undefined;
  storage?: Pick<BrowserSessionStorage, "load">;
}): Promise<boolean> {
  const { tcw, address, renewal, arrivedAt } = input;
  if (renewal === undefined || renewal === null || arrivedAt === undefined) return false;
  try {
    const storage = input.storage ?? new BrowserSessionStorage();
    const record = await storage.load(address);
    const grant = record?.tinycloudSession;
    const leaseAuthorization = record ? await verifiedRenewalLease(renewal, record) : null;
    if (!record || !grant || !leaseAuthorization) return false;
    const { receipt } = parseApprovalRenewal(renewal);
    const { origin } = await tcw.activeNodeIdentity();
    const remaining = arrivedAt + ADMIT_DEADLINE_MS - performance.now();
    if (!(remaining > 0)) return false;
    await admitOwnerRenewalLease({
      host: origin,
      originalAuthorization: grant.delegationHeader.Authorization.replace(/^Bearer\s+/i, ""),
      originalCid: grant.delegationCid,
      ownerDid: pkhDid(record.address, record.chainId),
      agentDid: grant.verificationMethod,
      spaceId: grant.spaceId,
      nodeIdentity: receipt.nodeIdentity,
      leaseAuthorization,
      leaseCid: receipt.leaseCid,
      leaseExpiresAt: receipt.leaseExpiresAt,
      signal: AbortSignal.timeout(Math.min(ADMIT_TIMEOUT_MS, remaining)),
    });
    // A sign-out during the admission cleared the record: keep no receipt beside a session that is gone.
    if ((await storage.load(address))?.tinycloudSession?.delegationCid !== grant.delegationCid)
      return false;
    saveRenewalReceipt(address, renewal);
    return true;
  } catch {
    return false;
  }
}

/** What a failed fetch looks like per engine: Chromium, Firefox, Safari and undici (Node). */
const NETWORK_FAILURE =
  /failed to fetch|networkerror|load failed|network request failed|fetch failed|timed? ?out/i;

/**
 * Does this error mean "couldn't reach the server" rather than "the server (or the saved session) said no"?
 * Network failures, aborts, timeouts and 408, 429 and 5xx answers qualify. Follows `cause` a few links, because SDK
 * layers wrap the underlying fetch error. Adapted from TinyChat's `isTransientRestoreError`.
 */
export function isTransientRestoreError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (typeof current !== "object") {
      return typeof current === "string" && NETWORK_FAILURE.test(current);
    }
    const { name, message, status } = current as {
      name?: unknown;
      message?: unknown;
      status?: unknown;
    };
    if (name === "AbortError" || name === "TimeoutError") return true;
    if (typeof status === "number" && (status >= 500 || status === 408 || status === 429))
      return true;
    if (typeof message === "string") {
      if (NETWORK_FAILURE.test(message)) return true;
      if (/\bHTTP (5\d\d|408|429)\b/.test(message)) return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * What a failed restore means for the saved session and its renewal receipt. Only a clearly transient failure keeps
 * them: a network failure, an abort or timeout, a 408, 429 or 5xx answer, or a device that is offline (it cannot tell
 * the two apart, and waiting costs one more restore while clearing costs a sign-in). Every other failure drops
 * them: an expired, corrupt, stale or missing session, a refused or ended lease, and any error that is not
 * recognisably transient. Only `restore-failed` wraps something thrown while rebuilding the session; every other
 * status is a verdict read from the saved session itself.
 */
export function renewalRestoreVerdict(
  status: string,
  error?: unknown,
  offline = typeof navigator !== "undefined" && navigator.onLine === false,
): "drop" | "keep" {
  if (status !== "restore-failed") return "drop";
  return offline || isTransientRestoreError(error) ? "keep" : "drop";
}

/** Acts on a failed restore of `address`: an authoritative answer clears the saved session and its receipt. */
export function settleFailedRestore(
  address: string,
  status: string,
  error?: unknown,
  offline?: boolean,
): "drop" | "keep" {
  const verdict = renewalRestoreVerdict(status, error, offline);
  if (verdict === "drop") clearPersistedSession(address);
  return verdict;
}

export interface RenewalRestore {
  address: string;
  leaseAuthorization: string;
  /** The saved session record the lease was verified against. */
  record: PersistedSessionData;
  /** True when the saved session is past its signed end, so only the lease can restore it. */
  pastSignedEnd: boolean;
}

/**
 * The saved session's verified renewal lease, when it has one. The account is the live bearer's, else the one the SDK
 * kept a renewal candidate for (a lapsed bearer is gone). No receipt, or one that does not check out against the saved
 * session record, answers null and the plain restore decides. `pastSignedEnd` says whether the lease must carry the
 * restore; before the signed end the lease only backs a reissued backend bearer.
 */
export async function renewalRestoreFor(
  bearerAddress: string | null,
  storage: Pick<
    BrowserSessionStorage,
    "activeAddressForRenewal" | "loadRenewalCandidate"
  > = new BrowserSessionStorage(),
): Promise<RenewalRestore | null> {
  const address = bearerAddress ?? storage.activeAddressForRenewal();
  if (!address) return null;
  // No receipt, no renewal: the saved session is then left for the plain restore to load.
  const receipt = loadRenewalReceipt(address);
  if (receipt === null) return null;
  const candidate = await storage.loadRenewalCandidate(address);
  if (candidate.status !== "renewal-candidate" && candidate.status !== "loaded") return null;
  const leaseAuthorization = await verifiedRenewalLease(receipt, candidate.data);
  if (!leaseAuthorization) return null;
  // A lease past its own end can renew nothing: drop its receipt, and the plain restore decides.
  if (Date.parse(parseApprovalRenewal(receipt).receipt.leaseExpiresAt) <= Date.now()) {
    clearRenewalReceipt(address);
    return null;
  }
  return {
    address,
    leaseAuthorization,
    record: candidate.data,
    pastSignedEnd: candidate.status === "renewal-candidate",
  };
}

/**
 * When the kept lease ends, for showing the owner that the session renews: the signed end of the receipt stored for
 * `address`, only if it checks out against the saved session. Null when nothing renews. Never throws.
 */
export async function keptLeaseEnd(
  address: string,
  storage: Pick<BrowserSessionStorage, "loadRenewalCandidate"> = new BrowserSessionStorage(),
): Promise<string | null> {
  try {
    const receipt = loadRenewalReceipt(address);
    if (receipt === null) return null;
    const candidate = await storage.loadRenewalCandidate(address);
    if (candidate.status !== "renewal-candidate" && candidate.status !== "loaded") return null;
    if (!(await verifiedRenewalLease(receipt, candidate.data))) return null;
    return parseApprovalRenewal(receipt).receipt.leaseExpiresAt;
  } catch {
    return null;
  }
}

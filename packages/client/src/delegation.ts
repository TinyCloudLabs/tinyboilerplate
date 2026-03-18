import { TinyCloudWeb, serializeDelegation } from "@tinycloud/web-sdk";
import {
  DEFAULT_DELEGATION_ACTIONS,
  DEFAULT_DELEGATION_EXPIRY_MS,
  DEFAULT_DELEGATION_PATH,
  DEFAULT_FETCH_TIMEOUT_MS,
  type DelegationResponse,
} from "@tinyboilerplate/core";

// ── Configuration ────────────────────────────────────────────────────

export interface DelegationOptions {
  actions?: string[];
  path?: string;
  expiryMs?: number;
}

// ── Create Delegation ────────────────────────────────────────────────

export async function createDelegation(
  tcw: TinyCloudWeb,
  backendDID: string,
  options?: DelegationOptions,
): Promise<string> {
  const actions = options?.actions
    ? [...options.actions]
    : [...DEFAULT_DELEGATION_ACTIONS];
  const path = options?.path ?? DEFAULT_DELEGATION_PATH;
  const expiryMs = options?.expiryMs ?? DEFAULT_DELEGATION_EXPIRY_MS;

  const delegation = await tcw.createDelegation({
    delegateDID: backendDID,
    path,
    actions,
    expiryMs,
  });

  return serializeDelegation(delegation);
}

// ── Send Delegation to Backend ───────────────────────────────────────

export async function sendDelegation(
  backendUrl: string,
  serialized: string,
  userAddress: string,
): Promise<DelegationResponse> {
  const res = await fetch(`${backendUrl}/api/delegations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Address": userAddress,
    },
    body: JSON.stringify({ serialized }),
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.message ?? err.error ?? res.statusText;
    throw new Error(`Failed to send delegation: ${detail}`);
  }

  return res.json() as Promise<DelegationResponse>;
}

// ── Check Delegation Status ──────────────────────────────────────────

export async function checkDelegationStatus(
  backendUrl: string,
  userAddress: string,
): Promise<DelegationResponse> {
  const res = await fetch(`${backendUrl}/api/delegations/status`, {
    headers: {
      "X-User-Address": userAddress,
    },
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.message ?? err.error ?? res.statusText;
    throw new Error(`Failed to check delegation status: ${detail}`);
  }

  return res.json() as Promise<DelegationResponse>;
}

// ── Revoke Delegation ────────────────────────────────────────────────

export async function revokeDelegation(
  backendUrl: string,
  userAddress: string,
): Promise<void> {
  const res = await fetch(`${backendUrl}/api/delegations`, {
    method: "DELETE",
    headers: {
      "X-User-Address": userAddress,
    },
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.message ?? err.error ?? res.statusText;
    throw new Error(`Failed to revoke delegation: ${detail}`);
  }
}

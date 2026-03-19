import { TinyCloudWeb, serializeDelegation } from "@tinycloud/web-sdk";
import {
  DEFAULT_DELEGATION_ACTIONS,
  DEFAULT_DELEGATION_EXPIRY_MS,
  DEFAULT_DELEGATION_PATH,
  type DelegationResponse,
} from "@tinyboilerplate/core";
import type { ApiClient } from "./api.js";

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
  const actions = options?.actions ? [...options.actions] : [...DEFAULT_DELEGATION_ACTIONS];
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
  api: ApiClient,
  serialized: string,
): Promise<DelegationResponse> {
  return api.post<DelegationResponse>("/api/delegations", { serialized });
}

// ── Check Delegation Status ──────────────────────────────────────────

export async function checkDelegationStatus(api: ApiClient): Promise<DelegationResponse> {
  return api.get<DelegationResponse>("/api/delegations/status");
}

// ── Revoke Delegation ────────────────────────────────────────────────

export async function revokeDelegation(api: ApiClient): Promise<void> {
  await api.del("/api/delegations");
}

import type { TinyCloudNode } from "@tinycloud/node-sdk";
import type { StoredDelegation, ISODateString } from "@tinyboilerplate/core";
import { toISODateString, consoleLogger, type Logger } from "@tinyboilerplate/core";
import { withSessionRefresh } from "./identity.js";

// ── Types ────────────────────────────────────────────────────────────

export interface DelegationMetadata {
  grantedAt?: ISODateString;
  expiresAt: ISODateString;
  actions: string[];
  path: string;
}

function isStoredDelegation(value: unknown): value is StoredDelegation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.serialized === "string" &&
    typeof v.expiresAt === "string" &&
    typeof v.grantedAt === "string" &&
    Array.isArray(v.actions) &&
    typeof v.path === "string"
  );
}

// ── Delegation Store Options ─────────────────────────────────────────

export interface DelegationStoreOptions {
  /** Logger instance for diagnostic output. Defaults to console. */
  logger?: Logger;
}

// ── Delegation Store ─────────────────────────────────────────────────

/**
 * Persists and retrieves user delegations using the backend's own
 * TinyCloud KV store.
 *
 * Key format: `delegations/{address}` in the backend's KV space.
 */
export class DelegationStore {
  private readonly logger: Logger;

  constructor(
    private readonly node: TinyCloudNode,
    options?: DelegationStoreOptions,
  ) {
    this.logger = options?.logger ?? consoleLogger;
  }

  /**
   * Store a serialized delegation for a user address.
   */
  async store(
    address: string,
    serialized: string,
    metadata: DelegationMetadata,
  ): Promise<void> {
    const key = this.keyFor(address);
    const record: StoredDelegation = {
      serialized,
      grantedAt: metadata.grantedAt ?? toISODateString(),
      expiresAt: metadata.expiresAt,
      actions: metadata.actions,
      path: metadata.path,
    };

    await withSessionRefresh(this.node, () =>
      this.node.kv.put(key, record),
    );
  }

  /**
   * Load the stored delegation for a user address.
   * Returns null if no delegation exists.
   */
  async load(address: string): Promise<StoredDelegation | null> {
    const key = this.keyFor(address);

    const result = await withSessionRefresh(this.node, () =>
      this.node.kv.get(key),
    );

    const response = (result as { data?: { data?: unknown } })?.data;
    if (!response) return null;

    try {
      // KV get returns { data: value } — unwrap it
      let raw: unknown = response.data ?? response;
      // Handle double-serialization (string) or direct object
      if (typeof raw === "string") raw = JSON.parse(raw);
      if (typeof raw === "string") raw = JSON.parse(raw); // double-encoded

      if (!isStoredDelegation(raw)) {
        this.logger.error("DelegationStore: stored data failed validation for key", this.keyFor(address));
        return null;
      }
      return raw;
    } catch {
      return null;
    }
  }

  /**
   * Remove the stored delegation for a user address.
   */
  async remove(address: string): Promise<void> {
    const key = this.keyFor(address);

    await withSessionRefresh(this.node, () =>
      this.node.kv.delete(key),
    );
  }

  /**
   * Check whether a stored delegation exists and is not expired.
   */
  async isActive(address: string): Promise<boolean> {
    const stored = await this.load(address);
    if (!stored) return false;
    return new Date(stored.expiresAt).getTime() > Date.now();
  }

  private keyFor(address: string): string {
    return `delegations/${address.toLowerCase()}`;
  }
}

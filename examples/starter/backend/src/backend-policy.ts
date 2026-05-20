import { createHash } from "crypto";
import type { ServerInfoPermission } from "@tinyboilerplate/core";

export const STARTER_APP_ID = "xyz.tinycloud.starter";
export const ITEM_KV_PATH = "items/";
export const ITEM_SQL_PATH = "items";

export const BACKEND_DELEGATION_PERMISSIONS: ServerInfoPermission[] = [
  {
    service: "tinycloud.kv",
    path: ITEM_KV_PATH,
    actions: ["get", "put", "del", "list"],
    description: "Read and write TinyCloud Starter item records in KV.",
  },
  {
    service: "tinycloud.sql",
    path: ITEM_SQL_PATH,
    actions: ["read", "write"],
    description: "Read and write TinyCloud Starter item records in SQL.",
  },
  {
    service: "tinycloud.duckdb",
    path: ITEM_SQL_PATH,
    actions: ["read", "write"],
    description: "Read and write TinyCloud Starter item records in DuckDB.",
  },
];

export function getBackendDelegationPolicyHash(): string {
  const stable = BACKEND_DELEGATION_PERMISSIONS.map((permission) => ({
    service: permission.service,
    space: permission.space ?? null,
    path: permission.path,
    actions: [...permission.actions].sort(),
    skipPrefix: permission.skipPrefix ?? false,
  })).sort((a, b) =>
    `${a.service}:${a.space}:${a.path}`.localeCompare(`${b.service}:${b.space}:${b.path}`),
  );

  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

// Live half of manifest-ddl-contract: ported from the dev-repo rig's
// tb-e2e-driver.mjs DDL legs so F1 protection travels with this repository.
// Measured on node v1.4.2 + @tinycloud/sdk-services 2.4.2, SQLAction.SCHEMA
// is "tinycloud.sql/schema" and all DDL routes through it. A delegation
// without schema is therefore rejected by the layer-1 ReCap capability check;
// this is the regression that broke TinyChat when its manifest omitted schema.
// Run the live legs with TB_E2E_NODE=1 against a local node (default :8013).
// Without that opt-in, Bun reports every live leg as skipped and prints a
// marker rather than pretending this network-dependent regression has passed.
import { beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { TinyCloudNode } from "@tinycloud/node-sdk";

const hasNode = process.env.TB_E2E_NODE === "1";
if (!hasNode) console.log("[ddl-e2e] SKIPPED: TB_E2E_NODE not set");

const PORT = process.env.TB_E2E_PORT ?? "8013";
const HOST = process.env.TINYCLOUD_HOST ?? `http://localhost:${PORT}`;
const MULTI_RESOURCE_MARKER = "does not support multi-resource invocations";

type Attempt = {
  res: {
    ok?: boolean;
    error?: {
      code?: string;
      meta?: { requiredAction?: string; status?: number };
      message?: string;
    };
  } | null;
  threw: string | null;
};

describe("DDL requires tinycloud.sql/schema (F1 e2e)", () => {
  let owner: TinyCloudNode;
  let bob: TinyCloudNode;

  beforeAll(async () => {
    if (!hasNode) return;

    owner = new TinyCloudNode({
      privateKey: `0x${randomBytes(32).toString("hex")}`,
      host: HOST,
      autoCreateSpace: true,
      autoBootstrapAccount: false,
    });
    await owner.signIn();
    await owner.sql
      .db("shared")
      .execute("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)")
      .catch(() => {});

    bob = new TinyCloudNode({
      privateKey: `0x${randomBytes(32).toString("hex")}`,
      host: HOST,
      autoBootstrapAccount: false,
    });
    await bob.signIn();
  }, 120_000);

  async function delegatedDb(actions: string[]) {
    const del = await owner.createDelegation({ path: "shared", actions, delegateDID: bob.did });
    const access = await bob.useDelegation(del);
    return access.sql.db("shared");
  }

  // Capture either the SDK's returned { ok, error } response or a thrown error.
  async function runOp(
    db: Awaited<ReturnType<typeof delegatedDb>>,
    kind: "query" | "execute",
    sql: string,
  ): Promise<Attempt> {
    try {
      const res = await (kind === "query" ? db.query(sql) : db.execute(sql));
      return { res, threw: null };
    } catch (error) {
      return { res: null, threw: error instanceof Error ? error.message : String(error) };
    }
  }

  // Positive and negative cases intentionally share this path; only actions vary.
  async function delegatedCreate(actions: string[]): Promise<Attempt> {
    const db = await delegatedDb(actions);
    return runOp(db, "execute", "CREATE TABLE IF NOT EXISTS ddl_probe (id INTEGER PRIMARY KEY)");
  }

  // A genuine node authorization denial, never a client multi-resource guard.
  function isServerAuthzDenial({ res, threw }: Attempt): boolean {
    if (threw) return false;
    if (res?.ok !== false) return false;
    const code = res?.error?.code;
    const status = res?.error?.meta?.status;
    const message = res?.error?.message ?? "";
    return (
      (code === "AUTH_UNAUTHORIZED" || code === "SQL_PERMISSION_DENIED") &&
      (status === 401 || status === 403) &&
      /Unauthorized Action:.*\/\s*tinycloud\.sql\//.test(message) &&
      !message.includes(MULTI_RESOURCE_MARKER)
    );
  }

  // The stricter F1 signature: a server-side 401 for exactly schema.
  function isSchemaAbilityDenial({ res, threw }: Attempt): boolean {
    if (threw) return false;
    if (res?.ok !== false) return false;
    const code = res?.error?.code;
    const status = res?.error?.meta?.status;
    const requiredAction = res?.error?.meta?.requiredAction;
    const message = res?.error?.message ?? "";
    return (
      code === "AUTH_UNAUTHORIZED" &&
      status === 401 &&
      requiredAction === "tinycloud.sql/schema" &&
      /Unauthorized Action:/.test(message) &&
      !message.includes(MULTI_RESOURCE_MARKER)
    );
  }

  function opline({ res, threw }: Attempt): string {
    return threw
      ? `THREW ${threw}`
      : `ok=${res?.ok} code=${res?.error?.code} status=${res?.error?.meta?.status} req=${res?.error?.meta?.requiredAction} msg=${res?.error?.message}`;
  }

  function classifyDdlAttempt(attempt: Attempt): string {
    if (isSchemaAbilityDenial(attempt)) return "server-schema-ability-denial";
    if (attempt.threw?.includes(MULTI_RESOURCE_MARKER)) {
      return `client-side multi-resource guard (NOT a server denial): ${attempt.threw}`;
    }
    if (attempt.threw) return `threw (not a returned server denial): ${attempt.threw}`;
    if (attempt.res?.ok) {
      return "VACUITY ALERT: CREATE TABLE was ALLOWED — DDL no longer requires the schema ability; F1's guard is dead";
    }
    return `rejected but NOT the pinned server-side denial (need 401 AUTH_UNAUTHORIZED requiredAction=tinycloud.sql/schema): ${opline(attempt)}`;
  }

  function classifyServerDenial(attempt: Attempt): string {
    if (isServerAuthzDenial(attempt)) return "server-authz-denial";
    if (attempt.threw?.includes(MULTI_RESOURCE_MARKER)) {
      return `client-side multi-resource guard (NOT a server denial): ${attempt.threw}`;
    }
    if (attempt.threw) return `threw (not a returned server denial): ${attempt.threw}`;
    if (attempt.res?.ok) return `VACUITY ALERT: CREATE TABLE was ALLOWED: ${opline(attempt)}`;
    return `rejected but NOT a pinned server-side authz denial: ${opline(attempt)}`;
  }

  function expectCreateAuthorized(attempt: Attempt): void {
    if (attempt.threw || attempt.res?.ok !== true) {
      throw new Error(`CREATE TABLE was not authorized: ${opline(attempt)}`);
    }
  }

  it.skipIf(!hasNode)(
    "[read,write,schema] delegation authorizes CREATE TABLE",
    async () => {
      const attempt = await delegatedCreate([
        "tinycloud.sql/read",
        "tinycloud.sql/write",
        "tinycloud.sql/schema",
      ]);
      expectCreateAuthorized(attempt);
    },
    120_000,
  );

  it.skipIf(!hasNode)(
    "[read,write] delegation requires schema for CREATE TABLE",
    async () => {
      const negative = await delegatedCreate(["tinycloud.sql/read", "tinycloud.sql/write"]);
      const positive = await delegatedCreate([
        "tinycloud.sql/read",
        "tinycloud.sql/write",
        "tinycloud.sql/schema",
      ]);

      expect(classifyDdlAttempt(negative)).toBe("server-schema-ability-denial");
      expectCreateAuthorized(positive);
    },
    120_000,
  );

  it.skipIf(!hasNode)(
    "[read]-only delegation is denied CREATE TABLE server-side",
    async () => {
      const attempt = await delegatedCreate(["tinycloud.sql/read"]);
      expect(classifyServerDenial(attempt)).toBe("server-authz-denial");
    },
    120_000,
  );
});

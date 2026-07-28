// Browser-direct storage guardrails, extracted from TinyChat's threadStore.ts as
// generic, dependency-free, independently unit-tested mechanisms. See each module
// for the "why" and the constraint it encodes.

export {
  createSchemaEnsurer,
  type SchemaEnsurer,
  type SchemaEnsurerOptions,
} from "./schema-ensurer.js";

export { createMutationGuard, type MutationGuard } from "./mutation-guard.js";

export {
  createDidKeyedCache,
  accountId,
  type DidKeyedCache,
  type DidKeyedCacheOptions,
  type DidKeyedSession,
  type KeyValueStorage,
} from "./did-keyed-cache.js";

export {
  isDdlStatement,
  assertDdlActionsGranted,
  resolveSqlDbHandle,
  assertFullPathDbHandle,
  SQL_SCHEMA_ACTION,
} from "./sql-constraints.js";

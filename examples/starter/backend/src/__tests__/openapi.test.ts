import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { load as loadYaml } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const spec = loadYaml(readFileSync(resolve(__dirname, "../../openapi.yaml"), "utf-8")) as Record<
  string,
  unknown
>;

describe("OpenAPI spec", () => {
  test("is valid OpenAPI 3.1.0", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
  });

  test("uses the starter app API title", () => {
    const info = spec.info as Record<string, unknown>;
    expect(info.title).toBe("TinyCloud Starter API");
  });

  test("contains all expected paths", () => {
    const paths = Object.keys(spec.paths as object);
    expect(paths).toContain("/api/server-info");
    expect(paths).toContain("/api/delegations");
    expect(paths).toContain("/api/delegations/status");
    expect(paths).toContain("/api/items");
    expect(paths).toContain("/api/items/{id}");
  });

  test("server-info has GET operation with no security", () => {
    const serverInfo = (spec.paths as Record<string, Record<string, unknown>>)["/api/server-info"];
    const get = serverInfo.get as Record<string, unknown>;
    expect(get).toBeDefined();
    expect(get.security).toEqual([]);
  });

  test("delegations has POST and DELETE operations", () => {
    const delegations = (spec.paths as Record<string, Record<string, unknown>>)["/api/delegations"];
    expect(delegations.post).toBeDefined();
    expect(delegations.delete).toBeDefined();
  });

  test("items/{id} has GET, PUT, DELETE operations", () => {
    const itemsById = (spec.paths as Record<string, Record<string, unknown>>)["/api/items/{id}"];
    expect(itemsById.get).toBeDefined();
    expect(itemsById.put).toBeDefined();
    expect(itemsById.delete).toBeDefined();
  });

  test("items list documents KV limit query parameter", () => {
    const items = (spec.paths as Record<string, Record<string, unknown>>)["/api/items"];
    const get = items.get as Record<string, unknown>;
    const parameters = get.parameters as Record<string, unknown>[];
    const limit = parameters.find((param) => param.name === "limit") as Record<string, unknown>;
    expect(limit).toBeDefined();
    expect(limit.in).toBe("query");
    expect(limit.schema).toMatchObject({ type: "integer", default: 25, maximum: 50 });
    expect(limit.description).toContain("does not provide cursor pagination");
  });

  test("item list metadata documents bounded KV samples, not cursor pagination", () => {
    const components = spec.components as Record<string, Record<string, unknown>>;
    const schemas = components.schemas as Record<string, Record<string, unknown>>;
    const meta = schemas.ItemListMeta as Record<string, unknown>;
    const required = meta.required as string[];
    const properties = meta.properties as Record<string, Record<string, unknown>>;

    expect(required).toEqual(expect.arrayContaining(["limitedBy", "supportsPagination", "note"]));
    expect(properties.limitedBy).toMatchObject({
      type: "string",
      enum: ["kv_value_fetch_limit"],
    });
    expect(properties.supportsPagination).toMatchObject({ type: "boolean", const: false });
    expect(properties.note.description).toContain("bounded sample");
  });

  test("store type parameter documents all runtime stores", () => {
    const components = spec.components as Record<string, Record<string, unknown>>;
    const parameters = components.parameters as Record<string, Record<string, unknown>>;
    const storeType = parameters.StoreType as Record<string, unknown>;
    const schema = storeType.schema as Record<string, unknown>;

    expect(schema).toMatchObject({ type: "string", default: "kv" });
    expect(schema.enum).toEqual(["kv", "sql", "duckdb"]);
  });

  test("server-info schema matches runtime/core response shape", () => {
    const components = spec.components as Record<string, Record<string, unknown>>;
    const schemas = components.schemas as Record<string, Record<string, unknown>>;
    const serverInfo = schemas.ServerInfo as Record<string, unknown>;
    const properties = serverInfo.properties as Record<string, Record<string, unknown>>;

    expect(serverInfo.required).toEqual(["did", "status"]);
    expect(properties.did).toMatchObject({ type: "string" });
    expect(properties.status).toMatchObject({ type: "string" });
    expect(properties.name).toMatchObject({ type: "string" });
    expect(properties.expiry).toMatchObject({ type: "string" });
    expect(properties.permissions).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/ServerInfoPermission" },
    });
  });

  test("server-info permission schema matches core permission entries", () => {
    const components = spec.components as Record<string, Record<string, unknown>>;
    const schemas = components.schemas as Record<string, Record<string, unknown>>;
    const permission = schemas.ServerInfoPermission as Record<string, unknown>;
    const properties = permission.properties as Record<string, Record<string, unknown>>;

    expect(permission.required).toEqual(["service", "path", "actions"]);
    expect(properties.service).toMatchObject({ type: "string" });
    expect(properties.space).toMatchObject({ type: "string" });
    expect(properties.path).toMatchObject({ type: "string" });
    expect(properties.actions).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(properties.skipPrefix).toMatchObject({ type: "boolean" });
    expect(properties.description).toMatchObject({ type: "string" });
  });

  test("defines all expected schemas", () => {
    const components = spec.components as Record<string, Record<string, unknown>>;
    const schemas = Object.keys(components.schemas as object);
    expect(schemas).toContain("Item");
    expect(schemas).toContain("CreateItemInput");
    expect(schemas).toContain("UpdateItemInput");
    expect(schemas).toContain("ItemResponse");
    expect(schemas).toContain("ItemListResponse");
    expect(schemas).toContain("ItemListMeta");
    expect(schemas).toContain("DelegationResponse");
    expect(schemas).toContain("ServerInfo");
    expect(schemas).toContain("ServerInfoPermission");
    expect(schemas).toContain("ApiError");
  });

  test("defines Bearer JWT security scheme", () => {
    const components = spec.components as Record<string, Record<string, unknown>>;
    const schemes = components.securitySchemes as Record<string, Record<string, unknown>>;
    expect(schemes.bearerAuth).toBeDefined();
    expect(schemes.bearerAuth.type).toBe("http");
    expect(schemes.bearerAuth.scheme).toBe("bearer");
  });
});

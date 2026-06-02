import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { load as loadYaml } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const spec = loadYaml(readFileSync(resolve(__dirname, "../../openapi.yaml"), "utf-8")) as Record<
  string,
  unknown
>;

function components() {
  return spec.components as Record<string, Record<string, unknown>>;
}

function paths() {
  return spec.paths as Record<string, Record<string, Record<string, unknown>>>;
}

describe("Notes OpenAPI spec", () => {
  test("is OpenAPI 3.1 and publishes the Notes routes", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(paths())).toEqual(
      expect.arrayContaining([
        "/api/manifest",
        "/api/server-info",
        "/api/auth/nonce",
        "/api/auth/verify",
        "/api/delegations",
        "/api/delegations/status",
        "/api/notes",
        "/api/notes/{id}",
      ]),
    );
  });

  test("defines bearer auth and leaves public bootstrap routes unauthenticated", () => {
    const schemes = components().securitySchemes as Record<string, Record<string, unknown>>;
    expect(schemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(paths()["/api/manifest"].get.security).toEqual([]);
    expect(paths()["/api/server-info"].get.security).toEqual([]);
    expect(paths()["/api/auth/nonce"].get.security).toEqual([]);
    expect(paths()["/api/auth/verify"].post.security).toEqual([]);
    expect(paths()["/api/notes"].get.security).toEqual([{ bearerAuth: [] }]);
  });

  test("documents delegation status including stale", () => {
    const schemas = components().schemas as Record<string, Record<string, any>>;
    expect(schemas.DelegationResponse.properties.status.enum).toEqual([
      "active",
      "expired",
      "none",
      "stale",
    ]);
  });

  test("server-info schema matches runtime response shape", () => {
    const schemas = components().schemas as Record<string, Record<string, any>>;
    const serverInfo = schemas.ServerInfo;
    const properties = serverInfo.properties;

    expect(serverInfo.required).toEqual([
      "did",
      "status",
      "name",
      "expiry",
      "permissions",
      "policyHash",
    ]);
    expect(properties.did).toMatchObject({ type: "string" });
    expect(properties.status).toMatchObject({ type: "string" });
    expect(properties.name).toMatchObject({ type: "string" });
    expect(properties.expiry).toMatchObject({ type: "string" });
    expect(properties.permissions).toMatchObject({
      type: "array",
      items: { $ref: "#/components/schemas/PermissionEntry" },
    });
    expect(properties.policyHash).toMatchObject({
      type: "string",
      pattern: "^[a-f0-9]{64}$",
    });
  });

  test("defines Note schemas and common API error responses", () => {
    const schemas = components().schemas as Record<string, Record<string, unknown>>;
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        "ApiError",
        "CreateNoteRequest",
        "DelegationResponse",
        "Note",
        "NoteListResponse",
        "NoteResponse",
        "UpdateNoteRequest",
      ]),
    );

    expect(paths()["/api/notes"].post.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/CreateNoteRequest" },
        },
      },
    });
    expect(paths()["/api/notes/{id}"].put.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/UpdateNoteRequest" },
        },
      },
    });
    expect(paths()["/api/notes"].get.responses["403"]).toEqual({
      $ref: "#/components/responses/DelegationRequired",
    });
    expect(paths()["/api/notes/{id}"].get.responses["404"]).toEqual({
      $ref: "#/components/responses/NotFound",
    });
  });
});

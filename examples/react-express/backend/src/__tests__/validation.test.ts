import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import express from "express";
import type { Server } from "http";
import { validate } from "../middleware/validation.js";
import {
  CreateItemSchema,
  UpdateItemSchema,
  StoreQuerySchema,
  ItemIdParamSchema,
  CreateDelegationSchema,
} from "@tinyboilerplate/core";

// ── Test App ─────────────────────────────────────────────────────────

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Route that validates body (create item)
  app.post("/items", validate({ body: CreateItemSchema }), (req, res) => {
    res.json({ ok: true, body: req.body });
  });

  // Route that validates body + params (update item)
  app.put(
    "/items/:id",
    validate({ body: UpdateItemSchema, params: ItemIdParamSchema }),
    (req, res) => {
      res.json({ ok: true, body: req.body, id: req.params.id });
    },
  );

  // Route that validates query (store selection)
  app.get("/items", validate({ query: StoreQuerySchema }), (req, res) => {
    res.json({ ok: true, store: req.query.store });
  });

  // Route that validates params only
  app.get("/items/:id", validate({ params: ItemIdParamSchema }), (req, res) => {
    res.json({ ok: true, id: req.params.id });
  });

  // Route that validates delegation body
  app.post(
    "/delegations",
    validate({ body: CreateDelegationSchema }),
    (req, res) => {
      res.json({ ok: true, body: req.body });
    },
  );

  return app;
}

// ── Helpers ──────────────────────────────────────────────────────────

function startServer(
  app: express.Express,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      resolve({ server, port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Validation Middleware", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const app = createTestApp();
    const result = await startServer(app);
    server = result.server;
    baseUrl = `http://localhost:${result.port}`;
  });

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  // ── Error Response Format ────────────────────────────────────────

  describe("error response format", () => {
    it("returns structured validation_error with details array", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      expect(body.message).toBe("Request validation failed");
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
    });

    it("each detail has field and message properties", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const body = await res.json();
      for (const detail of body.details) {
        expect(typeof detail.field).toBe("string");
        expect(typeof detail.message).toBe("string");
      }
    });
  });

  // ── CreateItemSchema ─────────────────────────────────────────────

  describe("CreateItemSchema validation", () => {
    it("rejects missing body entirely", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      const titleError = body.details.find(
        (d: any) => d.field === "title",
      );
      expect(titleError).toBeDefined();
    });

    it("rejects empty title string", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      const titleError = body.details.find(
        (d: any) => d.field === "title",
      );
      expect(titleError).toBeDefined();
      expect(titleError.message).toBe("Title is required");
    });

    it("rejects title that is a number", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: 123 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
    });

    it("rejects title that is null", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: null }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
    });

    it("rejects title that is a boolean", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: true }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
    });

    it("rejects title exceeding 500 characters", async () => {
      const longTitle = "a".repeat(501);
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: longTitle }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      const titleError = body.details.find(
        (d: any) => d.field === "title",
      );
      expect(titleError).toBeDefined();
      expect(titleError.message).toBe("Title must be 500 characters or less");
    });

    it("accepts title at exactly 500 characters", async () => {
      const maxTitle = "a".repeat(500);
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: maxTitle }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.body.title).toBe(maxTitle);
    });

    it("accepts valid title without data", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Valid Item" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.body.title).toBe("Valid Item");
    });

    it("accepts valid title with data", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "With Data", data: "some payload" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.body.title).toBe("With Data");
      expect(body.body.data).toBe("some payload");
    });

    it("strips extra fields from the body", async () => {
      const res = await fetch(`${baseUrl}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Clean",
          data: "ok",
          extraField: "should be stripped",
          another: 42,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.body.title).toBe("Clean");
      expect(body.body.data).toBe("ok");
      expect(body.body.extraField).toBeUndefined();
      expect(body.body.another).toBeUndefined();
    });
  });

  // ── UpdateItemSchema ─────────────────────────────────────────────

  describe("UpdateItemSchema validation", () => {
    it("rejects empty body (no fields provided)", async () => {
      const res = await fetch(`${baseUrl}/items/some-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
    });

    it("accepts only title", async () => {
      const res = await fetch(`${baseUrl}/items/some-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("accepts only data", async () => {
      const res = await fetch(`${baseUrl}/items/some-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "new data" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("accepts both title and data", async () => {
      const res = await fetch(`${baseUrl}/items/some-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated", data: "new data" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.body.title).toBe("Updated");
      expect(body.body.data).toBe("new data");
    });

    it("rejects empty title string", async () => {
      const res = await fetch(`${baseUrl}/items/some-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      const titleError = body.details.find(
        (d: any) => d.field === "title",
      );
      expect(titleError).toBeDefined();
      expect(titleError.message).toBe("Title must not be empty");
    });

    it("rejects title exceeding 500 characters on update", async () => {
      const longTitle = "a".repeat(501);
      const res = await fetch(`${baseUrl}/items/some-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: longTitle }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
    });

    it("reports (root) field for refinement error on empty body", async () => {
      const res = await fetch(`${baseUrl}/items/some-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const body = await res.json();
      const rootError = body.details.find(
        (d: any) => d.field === "(root)",
      );
      expect(rootError).toBeDefined();
      expect(rootError.message).toBe(
        "At least one field (title or data) must be provided",
      );
    });
  });

  // ── StoreQuerySchema ─────────────────────────────────────────────

  describe("StoreQuerySchema validation", () => {
    it("defaults to kv when no store param is provided", async () => {
      const res = await fetch(`${baseUrl}/items`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.store).toBe("kv");
    });

    it("accepts store=kv", async () => {
      const res = await fetch(`${baseUrl}/items?store=kv`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.store).toBe("kv");
    });

    it("accepts store=sql", async () => {
      const res = await fetch(`${baseUrl}/items?store=sql`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.store).toBe("sql");
    });

    it("rejects invalid store value", async () => {
      const res = await fetch(`${baseUrl}/items?store=invalid`);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      const storeError = body.details.find(
        (d: any) => d.field === "store",
      );
      expect(storeError).toBeDefined();
    });

    it("rejects store=redis", async () => {
      const res = await fetch(`${baseUrl}/items?store=redis`);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
    });
  });

  // ── ItemIdParamSchema ────────────────────────────────────────────

  describe("ItemIdParamSchema validation", () => {
    it("accepts a valid id parameter", async () => {
      const res = await fetch(`${baseUrl}/items/abc-123`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.id).toBe("abc-123");
    });

    it("accepts UUID-style id", async () => {
      const res = await fetch(
        `${baseUrl}/items/550e8400-e29b-41d4-a716-446655440000`,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    });
  });

  // ── CreateDelegationSchema ───────────────────────────────────────

  describe("CreateDelegationSchema validation", () => {
    it("rejects missing serialized field", async () => {
      const res = await fetch(`${baseUrl}/delegations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      const serializedError = body.details.find(
        (d: any) => d.field === "serialized",
      );
      expect(serializedError).toBeDefined();
    });

    it("rejects empty serialized string", async () => {
      const res = await fetch(`${baseUrl}/delegations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serialized: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      const serializedError = body.details.find(
        (d: any) => d.field === "serialized",
      );
      expect(serializedError).toBeDefined();
      expect(serializedError.message).toBe(
        "Serialized delegation is required",
      );
    });

    it("rejects non-string serialized (number)", async () => {
      const res = await fetch(`${baseUrl}/delegations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serialized: 12345 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
    });

    it("accepts valid serialized string", async () => {
      const res = await fetch(`${baseUrl}/delegations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serialized: "valid-delegation-data" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.body.serialized).toBe("valid-delegation-data");
    });

    it("strips extra fields from delegation body", async () => {
      const res = await fetch(`${baseUrl}/delegations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serialized: "valid",
          extraField: "should be stripped",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.body.serialized).toBe("valid");
      expect(body.body.extraField).toBeUndefined();
    });
  });

  // ── Multiple Validation Targets ──────────────────────────────────

  describe("multiple validation targets (body + params)", () => {
    it("validates both body and params, collecting all errors", async () => {
      // The PUT /items/:id route validates both body and params.
      // Send an empty body to trigger the UpdateItemSchema refinement error.
      // The :id param "some-id" is valid, so only body errors should appear.
      const res = await fetch(`${baseUrl}/items/valid-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation_error");
      expect(body.details.length).toBeGreaterThan(0);
    });

    it("passes valid body and params through to handler", async () => {
      const res = await fetch(`${baseUrl}/items/my-item-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated Title" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.id).toBe("my-item-id");
      expect(body.body.title).toBe("Updated Title");
    });
  });
});

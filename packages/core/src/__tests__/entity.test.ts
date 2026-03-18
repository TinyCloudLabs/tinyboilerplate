import { describe, it, expect } from "bun:test";
import type {
  Entity,
  CreateEntityInput,
  UpdateEntityInput,
  EntityResponse,
  EntityListResponse,
  Item,
  ISODateString,
} from "../index.js";
import { toISODateString } from "../index.js";

// ── Test helpers ────────────────────────────────────────────────────

const now = toISODateString();

// ── Type-level compatibility tests ──────────────────────────────────

describe("Entity generic types", () => {
  describe("Entity<T> with default type parameter", () => {
    it("accepts arbitrary data when T is omitted", () => {
      const entity: Entity = {
        id: "1",
        data: { anything: true, nested: { ok: 1 } },
        createdAt: now,
        updatedAt: now,
      };

      expect(entity.id).toBe("1");
      expect(entity.data).toEqual({ anything: true, nested: { ok: 1 } });
      expect(entity.createdAt).toBe(now);
      expect(entity.updatedAt).toBe(now);
    });
  });

  describe("Entity<T> with a concrete type", () => {
    interface BlogPostData {
      title: string;
      body: string;
      published: boolean;
    }

    it("enforces the typed data shape", () => {
      const post: Entity<BlogPostData> = {
        id: "post-1",
        data: { title: "Hello", body: "World", published: true },
        createdAt: now,
        updatedAt: now,
      };

      expect(post.data.title).toBe("Hello");
      expect(post.data.body).toBe("World");
      expect(post.data.published).toBe(true);
    });

    it("works with CreateEntityInput<T>", () => {
      const input: CreateEntityInput<BlogPostData> = {
        data: { title: "New Post", body: "Content", published: false },
      };

      expect(input.data.title).toBe("New Post");
      expect(input.data.published).toBe(false);
    });

    it("works with UpdateEntityInput<T> — all fields optional", () => {
      const partial: UpdateEntityInput<BlogPostData> = {
        data: { title: "Updated Title" },
      };

      expect(partial.data?.title).toBe("Updated Title");
      expect(partial.data?.body).toBeUndefined();
    });

    it("allows omitting data entirely in UpdateEntityInput", () => {
      const empty: UpdateEntityInput<BlogPostData> = {};
      expect(empty.data).toBeUndefined();
    });
  });

  describe("EntityResponse<T>", () => {
    it("wraps a single entity", () => {
      const response: EntityResponse<{ name: string }> = {
        entity: {
          id: "e-1",
          data: { name: "Alice" },
          createdAt: now,
          updatedAt: now,
        },
      };

      expect(response.entity.id).toBe("e-1");
      expect(response.entity.data.name).toBe("Alice");
    });
  });

  describe("EntityListResponse<T>", () => {
    it("wraps a list of entities with optional pagination", () => {
      const response: EntityListResponse<{ tag: string }> = {
        entities: [
          { id: "1", data: { tag: "a" }, createdAt: now, updatedAt: now },
          { id: "2", data: { tag: "b" }, createdAt: now, updatedAt: now },
        ],
        total: 100,
        cursor: "next-page-token",
      };

      expect(response.entities).toHaveLength(2);
      expect(response.entities[0].data.tag).toBe("a");
      expect(response.total).toBe(100);
      expect(response.cursor).toBe("next-page-token");
    });

    it("allows omitting optional pagination fields", () => {
      const response: EntityListResponse = {
        entities: [],
      };

      expect(response.entities).toEqual([]);
      expect(response.total).toBeUndefined();
      expect(response.cursor).toBeUndefined();
    });
  });

  describe("Item backward compatibility", () => {
    it("Item retains its original shape (top-level title and data)", () => {
      const item: Item = {
        id: "item-1",
        title: "My Item",
        data: "some payload",
        createdAt: now,
        updatedAt: now,
      };

      expect(item.id).toBe("item-1");
      expect(item.title).toBe("My Item");
      expect(item.data).toBe("some payload");
    });

    it("Item.data remains optional", () => {
      const item: Item = {
        id: "item-2",
        title: "No Data",
        createdAt: now,
        updatedAt: now,
      };

      expect(item.data).toBeUndefined();
    });

    it("Item is structurally distinct from Entity (different shape)", () => {
      // This test documents that Item has title/data at top level,
      // while Entity nests domain data inside .data — they are not
      // assignable to each other. This is intentional for backward
      // compatibility.
      const item: Item = {
        id: "x",
        title: "T",
        createdAt: now,
        updatedAt: now,
      };

      const entity: Entity<{ title: string }> = {
        id: "x",
        data: { title: "T" },
        createdAt: now,
        updatedAt: now,
      };

      // Both have id and timestamps, but data layout differs
      expect(item.title).toBe("T");
      expect(entity.data.title).toBe("T");
    });
  });
});

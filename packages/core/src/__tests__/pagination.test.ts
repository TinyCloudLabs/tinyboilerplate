import { describe, it, expect } from "bun:test";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type PaginationParams,
  type PaginationMeta,
  type PaginatedResponse,
  type Item,
  type ISODateString,
} from "../index.js";

describe("Pagination", () => {
  describe("constants", () => {
    it("DEFAULT_PAGE_LIMIT is 50", () => {
      expect(DEFAULT_PAGE_LIMIT).toBe(50);
    });

    it("MAX_PAGE_LIMIT is 200", () => {
      expect(MAX_PAGE_LIMIT).toBe(200);
    });

    it("DEFAULT_PAGE_LIMIT does not exceed MAX_PAGE_LIMIT", () => {
      expect(DEFAULT_PAGE_LIMIT).toBeLessThanOrEqual(MAX_PAGE_LIMIT);
    });
  });

  describe("PaginationParams", () => {
    it("allows empty params (all optional)", () => {
      const params: PaginationParams = {};
      expect(params.cursor).toBeUndefined();
      expect(params.limit).toBeUndefined();
      expect(params.offset).toBeUndefined();
    });

    it("accepts cursor-based params", () => {
      const params: PaginationParams = {
        cursor: "abc123",
        limit: 25,
      };
      expect(params.cursor).toBe("abc123");
      expect(params.limit).toBe(25);
    });

    it("accepts offset-based params", () => {
      const params: PaginationParams = {
        offset: 100,
        limit: 50,
      };
      expect(params.offset).toBe(100);
      expect(params.limit).toBe(50);
    });
  });

  describe("PaginationMeta", () => {
    it("requires hasMore, allows optional total and cursor", () => {
      const meta: PaginationMeta = { hasMore: false };
      expect(meta.hasMore).toBe(false);
      expect(meta.total).toBeUndefined();
      expect(meta.cursor).toBeUndefined();
    });

    it("includes total when known", () => {
      const meta: PaginationMeta = { hasMore: true, total: 150 };
      expect(meta.total).toBe(150);
    });

    it("includes cursor for next page", () => {
      const meta: PaginationMeta = { hasMore: true, cursor: "next_page_token" };
      expect(meta.cursor).toBe("next_page_token");
    });
  });

  describe("PaginatedResponse", () => {
    it("wraps items with pagination metadata", () => {
      const response: PaginatedResponse<{ name: string }> = {
        items: [{ name: "Alice" }, { name: "Bob" }],
        pagination: { hasMore: true, total: 100, cursor: "cursor_abc" },
      };

      expect(response.items).toHaveLength(2);
      expect(response.items[0].name).toBe("Alice");
      expect(response.pagination.hasMore).toBe(true);
      expect(response.pagination.total).toBe(100);
      expect(response.pagination.cursor).toBe("cursor_abc");
    });

    it("works with the Item type", () => {
      const now = "2024-01-15T12:00:00.000Z" as ISODateString;
      const response: PaginatedResponse<Item> = {
        items: [
          { id: "1", title: "First", createdAt: now, updatedAt: now },
          { id: "2", title: "Second", data: "some data", createdAt: now, updatedAt: now },
        ],
        pagination: { hasMore: false, total: 2 },
      };

      expect(response.items).toHaveLength(2);
      expect(response.items[0].title).toBe("First");
      expect(response.items[1].data).toBe("some data");
      expect(response.pagination.hasMore).toBe(false);
      expect(response.pagination.total).toBe(2);
      expect(response.pagination.cursor).toBeUndefined();
    });

    it("represents an empty last page", () => {
      const response: PaginatedResponse<Item> = {
        items: [],
        pagination: { hasMore: false, total: 0 },
      };

      expect(response.items).toHaveLength(0);
      expect(response.pagination.hasMore).toBe(false);
      expect(response.pagination.total).toBe(0);
    });
  });
});

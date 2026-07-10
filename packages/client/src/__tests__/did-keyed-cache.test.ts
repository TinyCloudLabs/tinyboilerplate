import { describe, test, expect, beforeEach } from "bun:test";
import {
  createDidKeyedCache,
  accountId,
  type KeyValueStorage,
} from "../storage/did-keyed-cache.js";

// In-memory KeyValueStorage so the test never depends on a real localStorage
// (bun test has no window). Records keys so we can assert WHAT was keyed on.
class MemStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe("createDidKeyedCache", () => {
  let storage: MemStorage;
  beforeEach(() => {
    storage = new MemStorage();
  });

  test("a RESTORED session (spaceId undefined) still hits the cache — the whole point of DID keying", () => {
    const cache = createDidKeyedCache<{ items: number[] }>({ namespace: "app:index", storage });
    const did = "did:pkh:eip155:1:0xabc";

    // Fresh sign-in: both did and spaceId present.
    cache.write({ did, spaceId: "space-123" }, { items: [1, 2, 3] });

    // Restored session: spaceId is undefined, did unchanged. Must still hit.
    const restored = cache.read({ did, spaceId: undefined });
    expect(restored).toEqual({ items: [1, 2, 3] });
  });

  test("the key is derived from the DID, not the spaceId", () => {
    const cache = createDidKeyedCache<number[]>({ namespace: "app:index", storage });
    const did = "did:pkh:eip155:1:0xabc";
    cache.write({ did, spaceId: "space-A" }, [9]);
    // Only ONE key, and it is namespace:did — not namespace:spaceId.
    expect([...storage.map.keys()]).toEqual([`app:index:${did}`]);
    // A read with a DIFFERENT spaceId but the SAME did still hits.
    expect(cache.read({ did, spaceId: "space-B" })).toEqual([9]);
  });

  test("no did AND no spaceId → no key → miss (never throws)", () => {
    const cache = createDidKeyedCache<number[]>({ namespace: "app:index", storage });
    expect(cache.keyFor({})).toBeNull();
    cache.write({}, [1]);
    expect(storage.map.size).toBe(0);
    expect(cache.read({})).toBeNull();
  });

  test("spaceId is used only as a fallback when no did is present", () => {
    const cache = createDidKeyedCache<number[]>({ namespace: "app:index", storage });
    cache.write({ spaceId: "space-only" }, [7]);
    expect([...storage.map.keys()]).toEqual(["app:index:space-only"]);
    expect(cache.read({ spaceId: "space-only" })).toEqual([7]);
  });

  test("remove drops the entry; unusable payloads read as null", () => {
    const cache = createDidKeyedCache<number[]>({ namespace: "app:index", storage });
    const did = "did:key:z6Mk";
    cache.write({ did }, [1, 2]);
    cache.remove({ did });
    expect(cache.read({ did })).toBeNull();

    // Corrupt payload → null, not a throw.
    storage.setItem(`app:index:${did}`, "{not json");
    expect(cache.read({ did })).toBeNull();
  });

  test("accountId prefers did over spaceId", () => {
    expect(accountId({ did: "d", spaceId: "s" })).toBe("d");
    expect(accountId({ spaceId: "s" })).toBe("s");
    expect(accountId({})).toBeNull();
    expect(accountId({ did: "" })).toBeNull(); // empty string is not usable
  });

  test("degrades to a no-op when no storage is available", () => {
    const cache = createDidKeyedCache<number[]>({ namespace: "app:index", storage: null });
    cache.write({ did: "d" }, [1]);
    expect(cache.read({ did: "d" })).toBeNull();
  });
});

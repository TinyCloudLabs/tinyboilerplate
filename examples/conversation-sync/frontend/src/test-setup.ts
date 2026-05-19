import "@testing-library/jest-dom/vitest";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
}

function isUsableStorage(value: unknown): value is Storage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Storage).getItem === "function" &&
    typeof (value as Storage).setItem === "function" &&
    typeof (value as Storage).removeItem === "function" &&
    typeof (value as Storage).clear === "function" &&
    typeof (value as Storage).key === "function"
  );
}

const storage = isUsableStorage(globalThis.localStorage)
  ? globalThis.localStorage
  : createMemoryStorage();

for (const target of [globalThis, window]) {
  if (!isUsableStorage(target.localStorage)) {
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: storage,
    });
  }
}

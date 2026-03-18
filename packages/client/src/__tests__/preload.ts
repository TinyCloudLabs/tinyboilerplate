// Stub browser globals needed by @tinycloud/web-sdk at module evaluation time.
// This runs as a bun test preload before any test file imports are resolved.

if (typeof globalThis.HTMLElement === "undefined") {
  (globalThis as Record<string, unknown>).HTMLElement = class HTMLElement {};
}

if (typeof globalThis.customElements === "undefined") {
  const registry = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).customElements = {
    define(name: string, ctor: unknown) {
      registry.set(name, ctor);
    },
    get(name: string) {
      return registry.get(name);
    },
  };
}

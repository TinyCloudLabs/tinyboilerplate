import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { consoleLogger, noopLogger, type Logger } from "../index.js";

describe("Logger", () => {
  describe("consoleLogger", () => {
    const methods = ["debug", "info", "warn", "error"] as const;

    for (const method of methods) {
      it(`delegates ${method}() to console.${method}`, () => {
        const spy = spyOn(console, method).mockImplementation(() => {});
        try {
          consoleLogger[method]("test message", { extra: true });
          expect(spy).toHaveBeenCalledWith("test message", { extra: true });
        } finally {
          spy.mockRestore();
        }
      });
    }
  });

  describe("noopLogger", () => {
    const methods = ["debug", "info", "warn", "error"] as const;

    for (const method of methods) {
      it(`${method}() does not throw`, () => {
        expect(() => noopLogger[method]("test message", { extra: true })).not.toThrow();
      });
    }

    it("does not write to console", () => {
      const spies = {
        debug: spyOn(console, "debug").mockImplementation(() => {}),
        info: spyOn(console, "info").mockImplementation(() => {}),
        warn: spyOn(console, "warn").mockImplementation(() => {}),
        error: spyOn(console, "error").mockImplementation(() => {}),
      };

      try {
        noopLogger.debug("should not appear");
        noopLogger.info("should not appear");
        noopLogger.warn("should not appear");
        noopLogger.error("should not appear");

        expect(spies.debug).not.toHaveBeenCalled();
        expect(spies.info).not.toHaveBeenCalled();
        expect(spies.warn).not.toHaveBeenCalled();
        expect(spies.error).not.toHaveBeenCalled();
      } finally {
        spies.debug.mockRestore();
        spies.info.mockRestore();
        spies.warn.mockRestore();
        spies.error.mockRestore();
      }
    });
  });

  describe("custom Logger", () => {
    it("receives calls when passed as a Logger", () => {
      const calls: Array<{ method: string; args: unknown[] }> = [];

      const customLogger: Logger = {
        debug(msg, ...args) {
          calls.push({ method: "debug", args: [msg, ...args] });
        },
        info(msg, ...args) {
          calls.push({ method: "info", args: [msg, ...args] });
        },
        warn(msg, ...args) {
          calls.push({ method: "warn", args: [msg, ...args] });
        },
        error(msg, ...args) {
          calls.push({ method: "error", args: [msg, ...args] });
        },
      };

      customLogger.debug("debug msg", 1);
      customLogger.info("info msg", { key: "val" });
      customLogger.warn("warn msg");
      customLogger.error("error msg", new Error("test"));

      expect(calls).toHaveLength(4);
      expect(calls[0]).toEqual({ method: "debug", args: ["debug msg", 1] });
      expect(calls[1]).toEqual({ method: "info", args: ["info msg", { key: "val" }] });
      expect(calls[2]).toEqual({ method: "warn", args: ["warn msg"] });
      expect(calls[3]).toEqual({ method: "error", args: ["error msg", expect.any(Error)] });
    });

    it("satisfies the Logger interface when using console directly", () => {
      // console is structurally compatible with Logger
      const logger: Logger = console;
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });
  });
});

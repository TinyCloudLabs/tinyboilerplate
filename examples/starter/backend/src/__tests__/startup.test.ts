import { Buffer } from "node:buffer";
import { describe, expect, test } from "bun:test";
import { createTinyCloudCompatibilityFetch, withStartupRetry } from "../startup.js";

describe("createTinyCloudCompatibilityFetch", () => {
  test("adds fetch headers that survive TinyCloud node-info protection", async () => {
    let observedArgs: string[] = [];
    const compatibilityFetch = createTinyCloudCompatibilityFetch(async (args) => {
      observedArgs = args;
      return curlResponse("ok");
    });

    const res = await compatibilityFetch("https://node.tinycloud.xyz/info");

    expect(await res.text()).toBe("ok");
    expect(observedArgs).toContain("-A");
    expect(observedArgs).toContain("curl/8.7.1");
    expect(observedArgs).toContain("-H");
    expect(observedArgs).toContain("Accept: */*");
  });

  test("preserves caller-provided compatibility headers", async () => {
    let observedArgs: string[] = [];
    const compatibilityFetch = createTinyCloudCompatibilityFetch(async (args) => {
      observedArgs = args;
      return curlResponse("ok");
    });

    await compatibilityFetch("https://node.tinycloud.xyz/info", {
      headers: {
        "user-agent": "custom-client/1.0",
        accept: "application/json",
      },
    });

    expect(observedArgs).toContain("-A");
    expect(observedArgs).toContain("custom-client/1.0");
    expect(observedArgs).toContain("Accept: application/json");
  });

  test("pipes request bodies through curl", async () => {
    let observedBody: Buffer | undefined;
    const compatibilityFetch = createTinyCloudCompatibilityFetch(async (args, body) => {
      observedBody = body;
      expect(args).toContain("--data-binary");
      expect(args).toContain("@-");
      return curlResponse("created", 201);
    });

    const res = await compatibilityFetch("https://node.tinycloud.xyz/invoke", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(await res.text()).toBe("created");
    expect(observedBody?.toString("utf8")).toBe('{"ok":true}');
  });
});

describe("withStartupRetry", () => {
  test("retries transient startup failures before succeeding", async () => {
    const retries: Array<{ attempt: number; delayMs: number; message: string }> = [];
    const sleeps: number[] = [];
    let calls = 0;

    const result = await withStartupRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error("Failed to fetch node info");
        }
        return "ready";
      },
      {
        attempts: 4,
        initialDelayMs: 10,
        maxDelayMs: 50,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        onRetry: (err, attempt, delayMs) => {
          retries.push({
            attempt,
            delayMs,
            message: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );

    expect(result).toBe("ready");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([10, 20]);
    expect(retries).toEqual([
      { attempt: 1, delayMs: 10, message: "Failed to fetch node info" },
      { attempt: 2, delayMs: 20, message: "Failed to fetch node info" },
    ]);
  });

  test("throws the final error after attempts are exhausted", async () => {
    let calls = 0;

    await expect(
      withStartupRetry(
        async () => {
          calls += 1;
          throw new Error(`still down ${calls}`);
        },
        {
          attempts: 3,
          initialDelayMs: 1,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow("still down 3");

    expect(calls).toBe(3);
  });
});

function curlResponse(body: string, status = 200) {
  return {
    code: 0,
    stdout: Buffer.from(
      `HTTP/2 ${status}\r\ncontent-type: text/plain\r\n\r\n${body}\n__tinyboilerplate_fetch_status__${status}`,
    ),
    stderr: Buffer.from(""),
  };
}

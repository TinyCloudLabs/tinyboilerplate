import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import {
  createBackendIdentity,
  type BackendIdentity,
  type BackendIdentityConfig,
} from "@tinyboilerplate/server";

const TINYCLOUD_COMPATIBILITY_USER_AGENT = "curl/8.7.1";
const CURL_STATUS_MARKER = "__tinyboilerplate_fetch_status__";

interface CurlResult {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
}

type CurlRunner = (
  args: string[],
  body: Buffer | undefined,
  signal: AbortSignal | undefined,
) => Promise<CurlResult>;

export function createTinyCloudCompatibilityFetch(
  runCurl: CurlRunner = runCurlCommand,
): typeof fetch {
  return (async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = request?.url ?? String(input);
    const method = init?.method ?? request?.method ?? "GET";
    const signal = init?.signal ?? request?.signal ?? undefined;
    const body = await getRequestBodyBuffer(request, init);
    const headers = mergeRequestHeaders(request, init);

    if (!headers.has("user-agent")) {
      headers.set("user-agent", TINYCLOUD_COMPATIBILITY_USER_AGENT);
    }
    if (!headers.has("accept")) {
      headers.set("accept", "*/*");
    }

    const args = buildCurlArgs(url, method, headers, body !== undefined);
    const result = await runCurl(args, body, signal);
    if (result.code !== 0) {
      throw new TypeError(
        `curl fetch failed with code ${result.code}: ${result.stderr.toString("utf8").trim()}`,
      );
    }

    return parseCurlResponse(result.stdout);
  }) as typeof fetch;
}

export function installTinyCloudCompatibilityFetch() {
  globalThis.fetch = createTinyCloudCompatibilityFetch();
}

function mergeRequestHeaders(request: Request | undefined, init: RequestInit | undefined) {
  const headers = new Headers(request?.headers);
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

async function getRequestBodyBuffer(
  request: Request | undefined,
  init: RequestInit | undefined,
): Promise<Buffer | undefined> {
  if (init?.body !== undefined && init.body !== null) {
    return bodyInitToBuffer(init.body);
  }
  if (request && request.method !== "GET" && request.method !== "HEAD") {
    return Buffer.from(await request.arrayBuffer());
  }
  return undefined;
}

async function bodyInitToBuffer(body: BodyInit): Promise<Buffer> {
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  if (body instanceof URLSearchParams) {
    return Buffer.from(body.toString());
  }
  if (body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  throw new TypeError("Unsupported request body type for TinyCloud compatibility fetch");
}

function buildCurlArgs(url: string, method: string, headers: Headers, hasBody: boolean) {
  const args = [
    "-sS",
    "-i",
    "--max-time",
    "30",
    "-X",
    method,
    "-w",
    `\n${CURL_STATUS_MARKER}%{http_code}`,
  ];

  headers.forEach((value, key) => {
    if (key.toLowerCase() === "user-agent") {
      args.push("-A", value);
      return;
    }
    args.push("-H", `${formatCurlHeaderName(key)}: ${value}`);
  });

  if (hasBody) {
    args.push("--data-binary", "@-");
  }

  args.push(url);
  return args;
}

function formatCurlHeaderName(name: string) {
  switch (name.toLowerCase()) {
    case "accept":
      return "Accept";
    case "authorization":
      return "Authorization";
    case "content-type":
      return "Content-Type";
    case "user-agent":
      return "User-Agent";
    default:
      return name;
  }
}

async function runCurlCommand(
  args: string[],
  body: Buffer | undefined,
  signal: AbortSignal | undefined,
): Promise<CurlResult> {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const abort = () => {
      child.kill("SIGTERM");
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (err) => {
      signal?.removeEventListener("abort", abort);
      reject(err);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      resolve({
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });

    child.stdin.end(body);
  });
}

function parseCurlResponse(stdout: Buffer): Response {
  const markerIndex = stdout.lastIndexOf(`\n${CURL_STATUS_MARKER}`);
  if (markerIndex === -1) {
    throw new TypeError("curl fetch response did not include a status marker");
  }

  const responseBytes = stdout.subarray(0, markerIndex);
  const status = Number(stdout.subarray(markerIndex + CURL_STATUS_MARKER.length + 1).toString());
  const separator = findHeaderSeparator(responseBytes);
  if (!Number.isInteger(status) || separator.index === -1) {
    throw new TypeError("curl fetch response was malformed");
  }

  const headerText = responseBytes.subarray(0, separator.index).toString("utf8");
  const body = responseBytes.subarray(separator.index + separator.length);
  const headers = parseResponseHeaders(headerText);

  return new Response(body, { status, headers });
}

function findHeaderSeparator(responseBytes: Buffer) {
  const crlf = responseBytes.indexOf("\r\n\r\n");
  if (crlf !== -1) {
    return { index: crlf, length: 4 };
  }
  const lf = responseBytes.indexOf("\n\n");
  return { index: lf, length: 2 };
}

function parseResponseHeaders(headerText: string) {
  const headers = new Headers();
  for (const line of headerText.split(/\r?\n/).slice(1)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return headers;
}

export interface StartupRetryConfig {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function withStartupRetry<T>(
  operation: () => Promise<T>,
  config: StartupRetryConfig = {},
): Promise<T> {
  const attempts = config.attempts ?? 5;
  const initialDelayMs = config.initialDelayMs ?? 500;
  const maxDelayMs = config.maxDelayMs ?? 5_000;
  const sleep =
    config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let delayMs = initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;

      config.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }

  throw lastError;
}

export function createBackendIdentityWithRetry(
  config: BackendIdentityConfig,
  retryConfig?: StartupRetryConfig,
): Promise<BackendIdentity> {
  return withStartupRetry(() => createBackendIdentity(config), retryConfig);
}

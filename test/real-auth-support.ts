import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Locator, Page } from "playwright";

export const DEFAULT_FRONTEND_URL = "http://localhost:5175";
export const DEFAULT_BACKEND_URL = "http://localhost:3003";
export const DEFAULT_SESSION_STORAGE_KEY = "tinycloud-app-starter:session";
export const REQUEST_HEADER_NAME = "X-Requested-With";
export const REQUEST_HEADER_VALUE = "XMLHttpRequest";

export type DelegationStatus = "active" | "expired" | "none" | "stale";

export interface RealAuthConfig {
  backendUrl: string;
  browserChannel: string | undefined;
  frontendUrl: string;
  probeValue: string;
  sessionStorageKey: string;
  timeoutMs: number;
  userDataDir: string | undefined;
}

export interface BackendIdentity {
  appId: string;
  backendDid: string;
  policyHash: string;
}

export interface DelegationResponse {
  status: DelegationStatus;
  expiresAt: string | null;
}

export interface StoredSession {
  address?: string;
  expiresAt: number;
  token: string;
}

export interface PlaywrightStorageState {
  cookies?: unknown[];
  origins?: Array<{
    origin: string;
    localStorage?: Array<{ name: string; value: string }>;
  }>;
}

export function resolveRealAuthCommandEnv({
  cwd,
  env,
}: {
  cwd: string;
  env: Record<string, string | undefined>;
}): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) resolved[key] = value;
  }

  const rootCa = detectMkcertRootCa(env);
  if (rootCa) resolved.NODE_EXTRA_CA_CERTS ??= rootCa;

  const localHttps = rootCa ? detectLocalHttps(cwd) : null;
  if (localHttps) {
    resolved.FRONTEND_URL ??= localHttps.frontendUrl;
    resolved.BACKEND_URL ??= localHttps.backendUrl;
  }

  return resolved;
}

export function resolveRealAuthConfig({
  cwd,
  env,
}: {
  cwd: string;
  env: Record<string, string | undefined>;
}): RealAuthConfig {
  return {
    backendUrl: normalizeBaseUrl(env.BACKEND_URL ?? DEFAULT_BACKEND_URL),
    browserChannel: browserChannelFromEnv(env),
    frontendUrl: normalizeBaseUrl(env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL),
    probeValue:
      env.REAL_AUTH_PROBE_VALUE ?? `TinyCloud real-auth manual ${new Date().toISOString()}`,
    sessionStorageKey: env.REAL_AUTH_SESSION_STORAGE_KEY ?? DEFAULT_SESSION_STORAGE_KEY,
    timeoutMs: parsePositiveInteger(env.REAL_AUTH_TIMEOUT_MS, 10 * 60 * 1000),
    userDataDir: env.REAL_AUTH_USER_DATA_DIR
      ? resolvePath(cwd, env.REAL_AUTH_USER_DATA_DIR)
      : undefined,
  };
}

export function extractSessionToken(
  storageState: PlaywrightStorageState,
  storageKey = DEFAULT_SESSION_STORAGE_KEY,
): string | null {
  return extractStoredSession(storageState, storageKey)?.token ?? null;
}

export function extractStoredSession(
  storageState: PlaywrightStorageState,
  storageKey = DEFAULT_SESSION_STORAGE_KEY,
): StoredSession | null {
  for (const origin of storageState.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (item.name !== storageKey) continue;
      try {
        const parsed = JSON.parse(item.value) as Partial<StoredSession>;
        if (typeof parsed.token !== "string" || parsed.token.length === 0) return null;
        if (typeof parsed.expiresAt !== "number") return null;
        return {
          address: typeof parsed.address === "string" ? parsed.address : undefined,
          expiresAt: parsed.expiresAt,
          token: parsed.token,
        };
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function fetchBackendIdentity(backendUrl: string): Promise<BackendIdentity> {
  const [manifest, serverInfo] = await Promise.all([
    fetchJson<Record<string, unknown>>(`${backendUrl}/api/manifest`),
    fetchJson<Record<string, unknown>>(`${backendUrl}/api/server-info`),
  ]);

  const appId = stringField(manifest, "app_id") ?? stringField(manifest, "appId");
  const backendDid = stringField(serverInfo, "did");
  const policyHash = stringField(serverInfo, "policyHash");
  if (!appId || !backendDid || !policyHash) {
    throw new Error(
      "Backend identity is incomplete. Expected app id from /api/manifest and DID/policy hash from /api/server-info.",
    );
  }

  return { appId, backendDid, policyHash };
}

export async function fetchDelegationStatus(
  backendUrl: string,
  token: string,
): Promise<DelegationResponse> {
  return fetchJson<DelegationResponse>(`${backendUrl}/api/delegations/status`, {
    headers: authHeaders(token),
  });
}

export async function fetchProbe(
  backendUrl: string,
  token: string,
): Promise<{ probe: { value: string; updatedAt: string } | null }> {
  return fetchJson<{ probe: { value: string; updatedAt: string } | null }>(
    `${backendUrl}/api/probe`,
    {
      headers: authHeaders(token),
    },
  );
}

export function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    [REQUEST_HEADER_NAME]: REQUEST_HEADER_VALUE,
  };
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Request failed ${response.status} ${response.statusText} for ${url}: ${body}`);
  }
  return (await response.json()) as T;
}

function normalizeBaseUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.search = "";
  if (url.pathname === "/") url.pathname = "";
  else url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(join(cwd, path));
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function browserChannelFromEnv(env: Record<string, string | undefined>): string | undefined {
  const raw = env.REAL_AUTH_BROWSER_CHANNEL ?? env.REAL_AUTH_BROWSER;
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || value === "bundled" || value === "chromium") return undefined;
  return value;
}

function detectLocalHttps(cwd: string): { backendUrl: string; frontendUrl: string } | null {
  const hasSourceCerts = hasCertPair(join(cwd, "templates/app-starter/frontend"));
  const hasGeneratedCerts = hasCertPair(join(cwd, "frontend"));
  if (!hasSourceCerts && !hasGeneratedCerts) return null;

  return {
    backendUrl: localHttpsUrl(DEFAULT_BACKEND_URL),
    frontendUrl: localHttpsUrl(DEFAULT_FRONTEND_URL),
  };
}

function hasCertPair(directory: string): boolean {
  return (
    existsSync(join(directory, "localhost.pem")) && existsSync(join(directory, "localhost-key.pem"))
  );
}

function localHttpsUrl(defaultUrl: string): string {
  const url = new URL(defaultUrl);
  url.protocol = "https:";
  url.hostname = "localhost";
  url.hash = "";
  url.search = "";
  url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

function detectMkcertRootCa(env: Record<string, string | undefined>): string | null {
  if (env.NODE_EXTRA_CA_CERTS) return env.NODE_EXTRA_CA_CERTS;

  const explicitCaRoot = env.REAL_AUTH_MKCERT_CAROOT;
  if (explicitCaRoot) {
    const rootCa = join(explicitCaRoot, "rootCA.pem");
    return existsSync(rootCa) ? rootCa : null;
  }

  try {
    const result = Bun.spawnSync(["mkcert", "-CAROOT"], {
      stderr: "ignore",
      stdout: "pipe",
    });
    if (result.exitCode !== 0) return null;

    const caRoot = new TextDecoder().decode(result.stdout).trim();
    const rootCa = join(caRoot, "rootCA.pem");
    return existsSync(rootCa) ? rootCa : null;
  } catch {
    return null;
  }
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ── delegation-authorization decoder (network-capture helper) ────────────────────
// Ported (mechanism, not app shape) from TinyChat's test/agent-flow-manual.ts:35-97.
// When you capture the Authorization a client sends with a delegated invoke, it is
// either a *signed UCAN* (a compact JWS: three base64url segments, header starts
// "eyJ", payload carries an `att` capability map) or a *bare CID / opaque token*
// (a reference the node must resolve server-side — NOT self-describing, no `att`).
// Telling the two apart is the generic, app-agnostic assertion any real-auth rig
// wants: "did the client actually send a signed capability, or just a CID?"

export type DelegationAuthorizationKind = "signed-ucan-jwt" | "bare-cid" | "missing";

export interface DelegationAuthorizationInfo {
  kind: DelegationAuthorizationKind;
  /** Sorted resource keys of the JWT `att` capability map (empty unless signed). */
  attResources: string[];
  /** The `exp` claim (seconds since epoch) when decodable, else null. */
  expiresAt: number | null;
  /** The token with any `Bearer ` prefix stripped, or null when absent. */
  token: string | null;
}

/** Decode a base64url string to UTF-8 (padding-tolerant). Pure. */
export function b64urlDecode(input: string): string {
  let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  return Buffer.from(b64, "base64").toString("utf8");
}

/**
 * Classify a delegation Authorization value: a signed UCAN JWT vs a bare CID vs
 * missing. Pure — no browser needed, so it is directly unit-testable. A JWT is
 * recognised by three `.`-separated segments whose header segment begins "eyJ"
 * (`{"...` base64url-encoded) AND whose payload decodes to an object carrying an
 * `att` map; anything else is treated as a bare CID / opaque token.
 */
export function classifyDelegationAuthorization(
  auth: string | null | undefined,
): DelegationAuthorizationInfo {
  if (!auth || !auth.trim()) {
    return { kind: "missing", attResources: [], expiresAt: null, token: null };
  }
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { kind: "missing", attResources: [], expiresAt: null, token: null };
  }

  const parts = token.split(".");
  if (parts.length >= 3 && parts[0].startsWith("eyJ")) {
    try {
      const payload = JSON.parse(b64urlDecode(parts[1])) as {
        att?: Record<string, unknown>;
        exp?: unknown;
      };
      const attResources =
        payload && typeof payload.att === "object" && payload.att !== null
          ? Object.keys(payload.att).sort()
          : [];
      const expiresAt = typeof payload?.exp === "number" ? payload.exp : null;
      // A UCAN carries an `att` map; a JWS that decodes but has no att is still
      // JWT-shaped, but it is not a delegation — classify by the att presence.
      if (attResources.length > 0) {
        return { kind: "signed-ucan-jwt", attResources, expiresAt, token };
      }
      return { kind: "bare-cid", attResources: [], expiresAt, token };
    } catch {
      // JWT-like (3 segments, eyJ header) but payload undecodable → not a usable
      // signed delegation; fall through to bare-cid.
      return { kind: "bare-cid", attResources: [], expiresAt: null, token };
    }
  }

  return { kind: "bare-cid", attResources: [], expiresAt: null, token };
}

// ── marker → reload → rehydrate persistence proof ────────────────────────────────
// Ported (mechanism, not app shape) from TinyChat's test/real-auth-manual.ts:19,
// 201-216. The generic idea: write a UNIQUE marker into the app, reload the page so
// nothing survives in memory, then prove the marker is restored from the user's
// TinyCloud space (not just an in-memory cache). The app-specific "where does the
// marker appear" is injected via a `locate` callback so this stays generic.

let persistenceMarkerCounter = 0;

/**
 * A unique marker safe to embed in app data and later assert after a reload.
 * Combines a base36 timestamp with a monotonic counter so two calls in the same
 * millisecond still differ. Pure (the only impurity is the clock/counter).
 */
export function createPersistenceMarker(prefix = "e2e"): string {
  persistenceMarkerCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${persistenceMarkerCounter.toString(36)}`;
}

export interface PersistenceProofOptions {
  page: Page;
  marker: string;
  /** Given the reloaded page and the marker, return the locator that must appear. */
  locate: (page: Page, marker: string) => Locator;
  reloadWaitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  timeoutMs?: number;
}

/**
 * Reload the page, then wait for the marker to reappear via the caller's locator —
 * proving the marked data was persisted to (and rehydrated from) storage. Returns
 * nothing; throws (via Playwright's waitFor) if the marker does not reappear.
 */
export async function verifyPersistedMarker({
  page,
  marker,
  locate,
  reloadWaitUntil = "domcontentloaded",
  timeoutMs = 30_000,
}: PersistenceProofOptions): Promise<void> {
  await page.reload({ waitUntil: reloadWaitUntil });
  await locate(page, marker).waitFor({ state: "visible", timeout: timeoutMs });
}

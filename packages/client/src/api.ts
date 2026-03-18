import type { ApiError } from "@tinyboilerplate/core";
import type { TokenStore, TokenRefreshConfig } from "./tokens.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ApiClientConfig {
  /** If set, auto-refresh tokens on 401 responses. */
  refreshConfig?: TokenRefreshConfig;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

// ── API Client ───────────────────────────────────────────────────────

/**
 * Create a fetch wrapper that auto-attaches Bearer auth from a TokenStore.
 * Optionally refreshes tokens on 401 responses.
 */
export function createApiClient(
  backendUrl: string,
  tokenStore: TokenStore,
  config?: ApiClientConfig,
): ApiClient {
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const token = tokenStore.getAccessToken();
    if (!token) {
      throw new Error("No access token available. Sign in first.");
    }

    const res = await fetch(`${backendUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    // Auto-refresh on 401 if configured
    if (res.status === 401 && config?.refreshConfig) {
      await tokenStore.refresh(config.refreshConfig);
      const newToken = tokenStore.getAccessToken();
      const retryRes = await fetch(`${backendUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${newToken}`,
        },
      });

      if (!retryRes.ok) {
        const err: ApiError = await retryRes.json().catch((cause) => ({
          error: `HTTP ${retryRes.status}`,
          message: retryRes.statusText,
        }));
        throw new Error(`API error (${retryRes.status}): ${err.message}`, {
          cause: err,
        });
      }

      if (retryRes.status === 204) return undefined as T;
      return retryRes.json() as Promise<T>;
    }

    if (!res.ok) {
      const err: ApiError = await res.json().catch((cause) => ({
        error: `HTTP ${res.status}`,
        message: res.statusText,
      }));
      throw new Error(`API error (${res.status}): ${err.message}`, {
        cause: err,
      });
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  return {
    get<T>(path: string): Promise<T> {
      return request<T>(path, { method: "GET" });
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return request<T>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    },
    put<T>(path: string, body?: unknown): Promise<T> {
      return request<T>(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    },
    del<T>(path: string): Promise<T> {
      return request<T>(path, { method: "DELETE" });
    },
  };
}

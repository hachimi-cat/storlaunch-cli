import { resolveApiKey, resolveApiUrl } from "./config.js";

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  sandbox?: boolean;
}

export interface ApiError {
  status: number;
  message: string;
  code?: string;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "ApiClientError";
    this.status = error.status;
    this.code = error.code;
  }
}

/**
 * The full URL of an API path. The configured API URL is the API root
 * (https://storlaunch.forjio.com/api/v1 by default; a bare host gets /api/v1 added).
 * A path is relative to that root whether it is written "/discount-codes" (the
 * hand-written commands) or "/api/v1/discount-codes" (the generated `api` commands).
 * `new URL("/discount-codes", root)` would drop the root's /api/v1 and land on the
 * website instead.
 */
export function apiUrl(path: string, baseUrl: string = resolveApiUrl()): URL {
  let root = baseUrl.replace(/\/+$/, "");
  if (!/\/api\/v1$/.test(root)) root += "/api/v1";
  const rel = path.replace(/^\/api\/v1(?=\/|\?|$)/, "");
  return new URL(root + (rel.startsWith("/") || rel.startsWith("?") || rel === "" ? rel : `/${rel}`));
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { method = "GET", body, query, sandbox } = options;

  const token = resolveApiKey({ sandbox });
  if (!token) {
    throw new ApiClientError({
      status: 401,
      message: "Not authenticated. Run `storlaunch auth login --key <api-key>` first.",
      code: "AUTH_REQUIRED",
    });
  }

  const url = apiUrl(path);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Storlaunch answers errors as { data: null, error: { code, message }, meta }.
    let errorBody: { message?: string; code?: string; error?: { message?: string; code?: string } } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // response body not JSON
    }

    throw new ApiClientError({
      status: response.status,
      message: errorBody.error?.message ?? errorBody.message ?? `API request failed with status ${response.status}`,
      code: errorBody.error?.code ?? errorBody.code,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

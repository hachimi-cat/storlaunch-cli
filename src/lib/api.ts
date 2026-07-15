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

  const baseUrl = resolveApiUrl();
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");

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
    let errorBody: { message?: string; code?: string } = {};
    try {
      errorBody = (await response.json()) as { message?: string; code?: string };
    } catch {
      // response body not JSON
    }

    throw new ApiClientError({
      status: response.status,
      message: errorBody.message ?? `API request failed with status ${response.status}`,
      code: errorBody.code,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

import { resolveApiUrl } from "./config.js";
import { getBuyerSession } from "./buyer-config.js";

export interface BuyerRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export class BuyerApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = "BuyerApiError";
  }
}

function apiBase(): string {
  // Strip /api/v1 suffix if caller configured that — buyer routes include /api/v1 explicitly.
  const raw = resolveApiUrl();
  return raw.replace(/\/api\/v1\/?$/, "");
}

/**
 * Buyer-authed request. Sends the stored session token as Cookie header.
 * For auth endpoints (verify-email, verify-otp), pass slug=null and no auth is attached.
 */
export async function buyerRequest<T = unknown>(
  slug: string | null,
  path: string,
  options: BuyerRequestOptions = {}
): Promise<{ data: T; setCookie?: string[] }> {
  const url = new URL(`${apiBase()}/api/v1${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (slug) {
    const session = getBuyerSession(slug);
    if (session) {
      headers.Cookie = `storlaunch_buyer_session=${session.token}`;
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* non-JSON (e.g. PDF) */ }

  if (!response.ok) {
    const msg = parsed?.error?.message ?? `HTTP ${response.status}`;
    const code = parsed?.error?.code;
    throw new BuyerApiError(response.status, msg, code);
  }

  const setCookie = response.headers.getSetCookie?.() ?? undefined;
  return { data: (parsed.data ?? parsed) as T, setCookie };
}

/**
 * Extract the `storlaunch_buyer_session=<value>` cookie from a Set-Cookie
 * response header array. Returns { token, expiresAt }.
 */
export function parseSessionCookie(setCookie: string[] | undefined): { token: string; expiresAt: string } | null {
  if (!setCookie) return null;
  for (const raw of setCookie) {
    const parts = raw.split(";").map((p) => p.trim());
    const tokenPart = parts.find((p) => p.startsWith("storlaunch_buyer_session="));
    if (!tokenPart) continue;
    const token = tokenPart.slice("storlaunch_buyer_session=".length);
    const maxAge = parts.find((p) => p.startsWith("Max-Age="))?.slice("Max-Age=".length);
    const expiresAt = maxAge
      ? new Date(Date.now() + parseInt(maxAge, 10) * 1000).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    return { token, expiresAt };
  }
  return null;
}

/**
 * Download a binary response (e.g., invoice PDF) to a Buffer.
 */
export async function buyerDownload(slug: string, path: string): Promise<Buffer> {
  const session = getBuyerSession(slug);
  const headers: Record<string, string> = {};
  if (session) headers.Cookie = `storlaunch_buyer_session=${session.token}`;
  const url = `${apiBase()}/api/v1${path}${path.includes("?") ? "&" : "?"}accountSlug=${encodeURIComponent(slug)}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new BuyerApiError(response.status, `Download failed (HTTP ${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

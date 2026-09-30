import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config module
vi.mock("../../lib/config.js", () => ({
  resolveApiKey: vi.fn(() => "sk_live_testkey123"),
  resolveApiUrl: vi.fn(() => "https://api.test.local/api/v1"),
}));

import { apiRequest, apiUrl, ApiClientError } from "../../lib/api.js";
import { resolveApiKey, resolveApiUrl } from "../../lib/config.js";

describe("apiRequest", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.mocked(resolveApiKey).mockReturnValue("sk_live_testkey123");
    vi.mocked(resolveApiUrl).mockReturnValue("https://api.test.local/api/v1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("makes GET request with auth header", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "acc_1", name: "Test" }),
    });

    const result = await apiRequest("/account");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toContain("/account");
    expect(options.method).toBe("GET");
    expect(options.headers.Authorization).toBe("Bearer sk_live_testkey123");
    expect(options.headers.Accept).toBe("application/json");
    expect(result).toEqual({ id: "acc_1", name: "Test" });
  });

  it("makes POST request with JSON body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "cs_1" }),
    });

    await apiRequest("/payment/checkout-sessions", {
      method: "POST",
      body: { amount: 50000, currency: "IDR" },
    });

    const [, options] = mockFetch.mock.calls[0]!;
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({ amount: 50000, currency: "IDR" });
  });

  it("appends query parameters to URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });

    await apiRequest("/payment/customers", {
      query: { limit: 10, email: "test@example.com", empty: undefined },
    });

    const [url] = mockFetch.mock.calls[0]!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("email")).toBe("test@example.com");
    expect(parsed.searchParams.has("empty")).toBe(false);
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiRequest("/payment/plans/plan_1", { method: "DELETE" });
    expect(result).toBeUndefined();
  });

  it("throws ApiClientError on 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Invalid API key", code: "INVALID_KEY" }),
    });

    await expect(apiRequest("/account")).rejects.toThrow(ApiClientError);

    try {
      await apiRequest("/account");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(401);
      expect((err as ApiClientError).message).toBe("Invalid API key");
      expect((err as ApiClientError).code).toBe("INVALID_KEY");
    }
  });

  it("throws ApiClientError on 429 rate limit", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: "Rate limited" }),
    });

    try {
      await apiRequest("/account");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(429);
    }
  });

  it("handles non-JSON error response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    });

    try {
      await apiRequest("/account");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(500);
      expect((err as ApiClientError).message).toContain("500");
    }
  });

  it("throws AUTH_REQUIRED when no token available", async () => {
    vi.mocked(resolveApiKey).mockReturnValue(null);

    try {
      await apiRequest("/account");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(401);
      expect((err as ApiClientError).code).toBe("AUTH_REQUIRED");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes sandbox flag to resolveApiKey", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await apiRequest("/account", { sandbox: true });
    expect(resolveApiKey).toHaveBeenCalledWith({ sandbox: true });
  });
});

// The API URL is the API root. `new URL("/discount-codes", root)` used to drop the
// root's /api/v1, so every hand-written command landed on the website instead.
describe("apiUrl", () => {
  const root = "https://storlaunch.forjio.com/api/v1";

  it("keeps the API root's /api/v1 for a hand-written path", () => {
    expect(apiUrl("/discount-codes", root).toString()).toBe("https://storlaunch.forjio.com/api/v1/discount-codes");
    expect(apiUrl("discount-codes", `${root}/`).toString()).toBe("https://storlaunch.forjio.com/api/v1/discount-codes");
  });

  it("does not double /api/v1 for a generated command's full path", () => {
    expect(apiUrl("/api/v1/discount-codes/dc_1", root).toString()).toBe("https://storlaunch.forjio.com/api/v1/discount-codes/dc_1");
  });

  it("adds /api/v1 to an API URL configured as a bare host, and keeps a proxy prefix", () => {
    expect(apiUrl("/modules", "https://storlaunch.test").toString()).toBe("https://storlaunch.test/api/v1/modules");
    expect(apiUrl("/modules", "https://proxy.test/storlaunch/api/v1/").toString()).toBe("https://proxy.test/storlaunch/api/v1/modules");
  });

  it("keeps a query string", () => {
    expect(apiUrl("/account/blog/posts?status=draft", root).toString()).toBe(`${root}/account/blog/posts?status=draft`);
  });

  it("is what apiRequest calls, and the envelope's error message is what it throws", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ data: null, error: { code: "INSUFFICIENT_PERMISSIONS", message: "API keys cannot revoke other API keys." } }),
      });
    vi.stubGlobal("fetch", mockFetch);
    vi.mocked(resolveApiUrl).mockReturnValue(root);
    try {
      await apiRequest("/discount-codes", { query: { limit: 5 } });
      expect(mockFetch.mock.calls[0]![0]).toBe(`${root}/discount-codes?limit=5`);
      await expect(apiRequest("/account/api-keys/k1", { method: "DELETE" })).rejects.toMatchObject({
        status: 403,
        code: "INSUFFICIENT_PERMISSIONS",
        message: "API keys cannot revoke other API keys.",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

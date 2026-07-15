import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../../lib/api.js", () => {
  class ApiClientError extends Error {
    status: number;
    constructor(e: { status: number; message: string }) {
      super(e.message);
      this.name = "ApiClientError";
      this.status = e.status;
    }
  }
  return { apiRequest: vi.fn(), ApiClientError };
});

vi.mock("../../lib/config.js", () => ({
  resolveApiKey: vi.fn(() => "sk_live_test"),
  resolveApiUrl: vi.fn(() => "https://api.test/v1"),
}));

import { apiRequest } from "../../lib/api.js";
import { feeds } from "../../commands/feeds.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(feeds);
  program.exitOverride();
  return program;
}

describe("sell feeds", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.mocked(apiRequest).mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    fetchSpy?.mockRestore();
  });

  it("urls --merchant demo prints three URLs from the override base", async () => {
    const p = createProgram();
    await p.parseAsync(["node", "cli", "feeds", "urls", "--merchant", "demo", "--base-url", "https://x.com"]);
    const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("https://x.com/api/v1/storefront/public/demo/feeds/google.xml");
    expect(stdout).toContain("https://x.com/api/v1/storefront/public/demo/feeds/meta.xml");
    expect(stdout).toContain("https://x.com/api/v1/storefront/public/demo/feeds/tiktok.xml");
  });

  it("inspect counts items + flags missing GTIN/image", async () => {
    const xml = `<?xml version="1.0"?>
<rss><channel>
  <item><g:id>a</g:id><g:gtin>0</g:gtin><g:image_link>x</g:image_link></item>
  <item><g:id>b</g:id></item>
  <item><g:id>c</g:id><g:image_link>y</g:image_link></item>
</channel></rss>`;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } }),
    );
    const p = createProgram();
    await p.parseAsync(["node", "cli", "--json", "feeds", "inspect", "--merchant", "demo", "--base-url", "https://x.com"]);
    const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(stdout);
    expect(parsed.items).toBe(3);
    expect(parsed.missingGtin).toBe(2);
    expect(parsed.missingImage).toBe(1);
  });

  it("inspect exits non-zero when the feed URL returns 404", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );
    const p = createProgram();
    await expect(p.parseAsync([
      "node", "cli", "feeds", "inspect", "--merchant", "ghost", "--base-url", "https://x.com",
    ])).rejects.toThrow(/process\.exit\(1\)/);
  });

  it("config get hits /account/feeds", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: { enabled: true, defaultGoogleProductCategory: null, includeUnpublished: false, urls: { google: "g", meta: "m", tiktok: "t" } },
    } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "feeds", "config", "get"]);
    expect(apiRequest).toHaveBeenCalledWith("/account/feeds", expect.objectContaining({ sandbox: undefined }));
  });

  it("config set --enable --default-category PATCHes those fields", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync([
      "node", "cli", "feeds", "config", "set",
      "--enable", "--default-category", "Apparel & Accessories",
    ]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/feeds",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({ enabled: true, defaultGoogleProductCategory: "Apparel & Accessories" }),
      }),
    );
  });

  it("config set --no-include-unpublished sets includeUnpublished false", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "feeds", "config", "set", "--no-include-unpublished"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/feeds",
      expect.objectContaining({ body: expect.objectContaining({ includeUnpublished: false }) }),
    );
  });
});

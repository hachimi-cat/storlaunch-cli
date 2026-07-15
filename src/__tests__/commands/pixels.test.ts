import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../../lib/api.js", () => {
  class ApiClientError extends Error {
    status: number;
    code?: string;
    constructor(e: { status: number; message: string; code?: string }) {
      super(e.message);
      this.name = "ApiClientError";
      this.status = e.status;
      this.code = e.code;
    }
  }
  return { apiRequest: vi.fn(), ApiClientError };
});

vi.mock("../../lib/config.js", () => ({
  resolveApiKey: vi.fn(() => "sk_live_test"),
  resolveApiUrl: vi.fn(() => "https://api.test/v1"),
}));

import { apiRequest } from "../../lib/api.js";
import { pixels } from "../../commands/pixels.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(pixels);
  program.exitOverride();
  return program;
}

describe("sell pixels", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

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
  });

  it("set --meta 123 --tiktok T1 sends PATCH with only those two fields", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: {
        metaPixelId: '123', metaCapiAccessToken: null, metaTestEventCode: null,
        googleAnalyticsId: null, googleAdsConversionId: null, googleAdsPurchaseLabel: null,
        tiktokPixelId: 'T1', enabled: true,
      },
    } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "pixels", "set", "--meta", "123", "--tiktok", "T1"]);
    expect(apiRequest).toHaveBeenCalledWith('/account/pixels', expect.objectContaining({
      method: 'PATCH',
      body: { metaPixelId: '123', tiktokPixelId: 'T1' },
    }));
  });

  it("clear --platform meta nullifies only Meta-related fields", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "pixels", "clear", "--platform", "meta"]);
    expect(apiRequest).toHaveBeenCalledWith('/account/pixels', expect.objectContaining({
      method: 'PATCH',
      body: { metaPixelId: null, metaCapiAccessToken: null, metaTestEventCode: null },
    }));
  });

  it("clear --platform google nullifies only Google fields", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "pixels", "clear", "--platform", "google"]);
    expect(apiRequest).toHaveBeenCalledWith('/account/pixels', expect.objectContaining({
      body: { googleAnalyticsId: null, googleAdsConversionId: null, googleAdsPurchaseLabel: null },
    }));
  });

  it("clear --platform tiktok nullifies only the TikTok pixel ID", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "pixels", "clear", "--platform", "tiktok"]);
    expect(apiRequest).toHaveBeenCalledWith('/account/pixels', expect.objectContaining({
      body: { tiktokPixelId: null },
    }));
  });

  it("set --enable flag forwards enabled=true in the body", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { enabled: true } } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "pixels", "set", "--enable", "--meta", "M_EN"]);
    // Note: Commander shares option state with the module-level pixels command
    // across tests, so we tolerate extra fields from prior invocations and
    // just assert the new ones are present.
    expect(apiRequest).toHaveBeenCalledWith('/account/pixels', expect.objectContaining({
      method: 'PATCH',
      body: expect.objectContaining({ enabled: true, metaPixelId: 'M_EN' }),
    }));
  });

  it("test --platform meta --session cs_1 POSTs to the test-capi endpoint", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { sent: true } } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "pixels", "test", "--platform", "meta", "--session", "cs_1"]);
    expect(apiRequest).toHaveBeenCalledWith('/account/pixels/test-capi', expect.objectContaining({
      method: 'POST',
      body: { sessionId: 'cs_1' },
    }));
  });

  it("test --platform google exits — currently Meta-only", async () => {
    const p = createProgram();
    await expect(p.parseAsync(["node", "cli", "pixels", "test", "--platform", "google", "--session", "cs_1"]))
      .rejects.toThrow(/process\.exit\(1\)/);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

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
import { abandonedCart } from "../../commands/abandoned-cart.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(abandonedCart);
  program.exitOverride();
  return program;
}

describe("sell abandoned-cart", () => {
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

  it("config get fetches /account/abandoned-cart", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: { enabled: true, delayHours: 4, emailSubject: "X", emailPreview: "Y", discountCodeId: null },
    } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "abandoned-cart", "config", "get"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/abandoned-cart",
      expect.objectContaining({ sandbox: undefined }),
    );
  });

  it("config set --enable --delay-hours 6 PATCHes with those fields", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "abandoned-cart", "config", "set", "--enable", "--delay-hours", "6"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/abandoned-cart",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({ enabled: true, delayHours: 6 }),
      }),
    );
  });

  it("config set --no-discount-code nulls the discount", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "abandoned-cart", "config", "set", "--no-discount-code"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/abandoned-cart",
      expect.objectContaining({ body: expect.objectContaining({ discountCodeId: null }) }),
    );
  });

  it("config set --discount-code WELCOME10 resolves to id via list endpoint", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ data: [{ id: "dc_1", code: "WELCOME10" }] } as unknown as never)
      .mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "abandoned-cart", "config", "set", "--discount-code", "WELCOME10"]);
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(apiRequest).toHaveBeenLastCalledWith(
      "/account/abandoned-cart",
      expect.objectContaining({ body: expect.objectContaining({ discountCodeId: "dc_1" }) }),
    );
  });

  it("list calls /reminders with limit", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: [] } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "abandoned-cart", "list", "--limit", "5"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/abandoned-cart/reminders",
      expect.objectContaining({ query: expect.objectContaining({ limit: "5" }) }),
    );
  });

  it("stats --window 7d passes windowDays=7", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: { remindersSent: 0, cartsRecovered: 0, recoveryRate: 0, recoveredRevenue: 0, currency: null },
    } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "abandoned-cart", "stats", "--window", "7d"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/abandoned-cart/stats",
      expect.objectContaining({ query: expect.objectContaining({ windowDays: "7" }) }),
    );
  });
});

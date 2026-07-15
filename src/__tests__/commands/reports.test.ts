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
import { reports } from "../../commands/reports.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(reports);
  program.exitOverride();
  return program;
}

describe("reports commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.mocked(apiRequest).mockReset();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("date,entry_id\n2026-02-05,ledg_1\n", { status: 200, headers: { "Content-Type": "text/csv" } })
    );
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("pnl GETs /reports/pnl with from/to", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: {
        revenue: { sales: 100, refunds: 10, net: 90 },
        expenses: { platformFees: 5, channelFees: 3, shippingCosts: 2, shippingRefunds: 0, total: 10 },
        netProfit: 80,
        currency: "IDR",
        entryCount: 5,
      },
    });

    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "reports", "pnl",
      "--from", "2026-02-01T00:00:00Z",
      "--to", "2026-02-28T23:59:59Z",
    ]);

    expect(apiRequest).toHaveBeenCalledWith(
      "/reports/pnl",
      expect.objectContaining({
        query: expect.objectContaining({
          from: "2026-02-01T00:00:00Z",
          to: "2026-02-28T23:59:59Z",
        }),
      })
    );
  });

  it("cash-flow GETs /reports/cash-flow", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: {
        openingBalance: 0,
        closingBalance: 100,
        netChange: 100,
        totalIn: 100,
        totalOut: 0,
        inflows: { sale: 100 },
        outflows: {},
        entryCount: 1,
        currency: "IDR",
      },
    });

    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "reports", "cash-flow",
      "--from", "2026-02-01T00:00:00Z",
      "--to", "2026-02-28T23:59:59Z",
      "--currency", "IDR",
    ]);

    expect(apiRequest).toHaveBeenCalledWith(
      "/reports/cash-flow",
      expect.objectContaining({
        query: expect.objectContaining({ currency: "IDR" }),
      })
    );
  });

  it("export-ledger fetches CSV via raw fetch", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "reports", "export-ledger",
      "--from", "2026-02-01T00:00:00Z",
      "--to", "2026-02-28T23:59:59Z",
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/reports/ledger.csv"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("Bearer"),
        }),
      })
    );
  });
});

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
import { payouts } from "../../commands/payouts.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(payouts);
  program.exitOverride();
  return program;
}

describe("payouts commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.mocked(apiRequest).mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("bank-account set PATCHes /payouts/bank-account", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { configured: true } });

    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "payouts", "bank-account", "set",
      "--name", "Bank Central Asia",
      "--number", "1234567890",
      "--holder", "Adhya",
      "--code", "BCA",
    ]);

    expect(apiRequest).toHaveBeenCalledWith(
      "/payouts/bank-account",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          bankName: "Bank Central Asia",
          bankAccountNumber: "1234567890",
          bankAccountHolder: "Adhya",
          bankCode: "BCA",
        }),
      })
    );
  });

  it("balance GETs /payouts/balance", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { available: 100000, locked: 0 } });

    const program = createProgram();
    await program.parseAsync(["node", "storlaunch", "payouts", "balance"]);

    expect(apiRequest).toHaveBeenCalledWith("/payouts/balance", expect.anything());
  });

  it("list GETs /payouts with filters", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });

    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "payouts", "list", "--status", "pending", "--limit", "20",
    ]);

    expect(apiRequest).toHaveBeenCalledWith(
      "/payouts",
      expect.objectContaining({
        query: expect.objectContaining({ status: "pending", limit: 20 }),
      })
    );
  });

  it("create POSTs /payouts", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "po_1", status: "pending" } });

    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "payouts", "create",
      "--amount", "500000", "--currency", "IDR", "--note", "April earnings",
    ]);

    expect(apiRequest).toHaveBeenCalledWith(
      "/payouts",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          amount: 500000,
          currency: "IDR",
          note: "April earnings",
        }),
      })
    );
  });

  it("create with --bank-* overrides passes override body", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "po_2", status: "pending" } });

    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "payouts", "create",
      "--amount", "100000", "--currency", "IDR",
      "--bank-name", "Mandiri", "--bank-number", "987", "--bank-holder", "X",
    ]);

    expect(apiRequest).toHaveBeenCalledWith(
      "/payouts",
      expect.objectContaining({
        body: expect.objectContaining({
          bankName: "Mandiri",
          bankAccountNumber: "987",
          bankAccountHolder: "X",
        }),
      })
    );
  });

  it("cancel POSTs /payouts/:id/cancel", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "po_1", status: "cancelled" } });

    const program = createProgram();
    await program.parseAsync(["node", "storlaunch", "payouts", "cancel", "po_1"]);

    expect(apiRequest).toHaveBeenCalledWith(
      "/payouts/po_1/cancel",
      expect.objectContaining({ method: "POST" })
    );
  });
});

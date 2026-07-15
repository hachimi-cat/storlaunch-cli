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
import { ledger } from "../../commands/ledger.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(ledger);
  program.exitOverride();
  return program;
}

describe("ledger commands", () => {
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

  describe("entries", () => {
    it("list GETs /ledger/entries with filters", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "ledger", "entries", "list",
        "--type", "credit",
        "--category", "sale",
        "--customer", "cust_1",
        "--from", "2026-04-01T00:00:00Z",
        "--limit", "10",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/ledger/entries",
        expect.objectContaining({
          query: expect.objectContaining({
            type: "credit",
            category: "sale",
            customerId: "cust_1",
            from: "2026-04-01T00:00:00Z",
            limit: 10,
          }),
        })
      );
    });

    it("get GETs /ledger/entries/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "ledg_1" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "ledger", "entries", "get", "ledg_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/ledger/entries/ledg_1",
        expect.anything()
      );
    });
  });

  describe("balance", () => {
    it("account GETs /ledger/balance", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { balance: 100000 } });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "ledger", "balance", "account"]);

      expect(apiRequest).toHaveBeenCalledWith("/ledger/balance", expect.anything());
    });

    it("customer GETs /ledger/balance/customers/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { balance: -5000 } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "ledger", "balance", "customer", "cust_ar_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/ledger/balance/customers/cust_ar_1",
        expect.anything()
      );
    });
  });

  describe("adjustments", () => {
    it("create POSTs /ledger/adjustments", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "ledg_adj_1", balanceAfter: 10000 } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "ledger", "adjustments", "create",
        "--type", "credit",
        "--amount", "10000",
        "--currency", "IDR",
        "--description", "goodwill credit",
        "--customer", "cust_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/ledger/adjustments",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            type: "credit",
            amount: 10000,
            currency: "IDR",
            description: "goodwill credit",
            customerId: "cust_1",
          }),
        })
      );
    });
  });
});

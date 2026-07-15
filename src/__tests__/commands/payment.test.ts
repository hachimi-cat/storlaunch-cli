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
  setConfig: vi.fn(),
  clearConfig: vi.fn(),
  getConfig: vi.fn(() => ({ api_url: "https://api.test/v1", token: "sk_live_test" })),
  getConfigPath: vi.fn(() => "/tmp/.storlaunch/config.json"),
  resolveApiKey: vi.fn(() => "sk_live_test"),
  resolveApiUrl: vi.fn(() => "https://api.test/v1"),
}));

import { apiRequest, ApiClientError } from "../../lib/api.js";
import { payment } from "../../commands/payment.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(payment);
  program.exitOverride();
  return program;
}

describe("payment commands", () => {
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

  describe("checkout create", () => {
    it("calls POST /payment/checkout-sessions with correct body", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "cs_1", status: "open", url: "https://pay.test/cs_1" });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "payment", "checkout", "create",
        "--amount", "50000", "--currency", "IDR", "--description", "Pro Plan",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/checkout-sessions",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ amount: 50000, currency: "IDR", description: "Pro Plan" }),
        })
      );
    });

    it("outputs JSON when --json flag is set", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "cs_1", status: "open" });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "payment", "checkout", "create",
        "--amount", "50000", "--currency", "IDR", "--json",
      ]);

      const jsonCall = logSpy.mock.calls.find((c) => {
        try { JSON.parse(String(c[0])); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
    });
  });

  describe("checkout list", () => {
    it("calls GET /payment/checkout-sessions with query params", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "payment", "checkout", "list", "--status", "completed", "--limit", "5",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/checkout-sessions",
        expect.objectContaining({
          query: expect.objectContaining({ status: "completed", limit: 5 }),
        })
      );
    });
  });

  describe("plans create", () => {
    it("calls POST /payment/plans with required fields", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "plan_1", name: "Pro", amount: 149000, currency: "IDR", interval: "monthly" });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "payment", "plans", "create",
        "--name", "Pro", "--amount", "149000", "--currency", "IDR", "--interval", "monthly",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plans",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ name: "Pro", amount: 149000, currency: "IDR", interval: "monthly" }),
        })
      );
    });
  });

  describe("plans delete", () => {
    it("calls DELETE /payment/plans/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "payment", "plans", "delete", "plan_abc"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plans/plan_abc",
        expect.objectContaining({ method: "DELETE" })
      );
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes("archived"))).toBe(true);
    });
  });

  describe("customers create", () => {
    it("calls POST /payment/customers with email", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "cust_1", email: "buyer@test.com", name: "Budi" });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "payment", "customers", "create",
        "--email", "buyer@test.com", "--name", "Budi",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/customers",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ email: "buyer@test.com", name: "Budi" }),
        })
      );
    });
  });

  describe("subscriptions cancel", () => {
    it("calls DELETE /payment/subscriptions/:id with immediate flag", async () => {
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "payment", "subscriptions", "cancel", "sub_123", "--immediate",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/subscriptions/sub_123",
        expect.objectContaining({
          method: "DELETE",
          body: { immediate: true },
        })
      );
    });
  });

  describe("portal create", () => {
    it("calls POST /payment/portal-sessions", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "ps_1", url: "https://portal.test/ps_1" });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "payment", "portal", "create", "--customer", "cust_abc",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/portal-sessions",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ customerId: "cust_abc" }),
        })
      );
    });
  });

  describe("error handling", () => {
    it("exits with code 2 on auth error", async () => {
      vi.mocked(apiRequest).mockRejectedValue(
        new ApiClientError({ status: 403, message: "Forbidden" })
      );

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "payment", "checkout", "list"])
      ).rejects.toThrow("process.exit(2)");
    });

    it("exits with code 4 on quota exceeded", async () => {
      vi.mocked(apiRequest).mockRejectedValue(
        new ApiClientError({ status: 402, message: "Quota exceeded", code: "QUOTA_EXCEEDED" })
      );

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "payment", "checkout", "list"])
      ).rejects.toThrow("process.exit(4)");
    });

    it("outputs JSON error when --json flag is set", async () => {
      vi.mocked(apiRequest).mockRejectedValue(
        new ApiClientError({ status: 400, message: "Bad request", code: "INVALID_INPUT" })
      );

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "payment", "plans", "list", "--json"])
      ).rejects.toThrow("process.exit(1)");

      const errCall = errorSpy.mock.calls.find((c) => {
        try { const p = JSON.parse(String(c[0])); return p.error !== undefined; } catch { return false; }
      });
      expect(errCall).toBeDefined();
      const parsed = JSON.parse(String(errCall![0]));
      expect(parsed.error.code).toBe("INVALID_INPUT");
      expect(parsed.data).toBeNull();
    });
  });
});

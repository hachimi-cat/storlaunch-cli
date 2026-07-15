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

import { apiRequest } from "../../lib/api.js";
import { modules } from "../../commands/modules.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(modules);
  program.exitOverride();
  return program;
}

describe("modules commands", () => {
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

  describe("list", () => {
    it("calls GET /modules", async () => {
      vi.mocked(apiRequest).mockResolvedValue({
        data: {
          modules: { payment: { enabled: true }, fulfillment: { enabled: false } },
          allowed: ["payment", "fulfillment", "marketing"],
          plan: "pro",
        },
      });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "modules", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/modules",
        expect.objectContaining({})
      );
      const call = vi.mocked(apiRequest).mock.calls[0]![1] ?? {};
      expect(call.method ?? "GET").toBe("GET");
    });
  });

  describe("enable", () => {
    it("calls POST /modules with { module, enabled:true }", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { modules: { payment: { enabled: true } } } });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "modules", "enable", "payment"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/modules",
        expect.objectContaining({
          method: "POST",
          body: { module: "payment", enabled: true },
        })
      );
    });
  });

  describe("disable", () => {
    it("calls POST /modules with { module, enabled:false }", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { modules: { payment: { enabled: false } } } });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "modules", "disable", "payment"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/modules",
        expect.objectContaining({
          method: "POST",
          body: { module: "payment", enabled: false },
        })
      );
    });
  });

  describe("status", () => {
    it("calls GET /modules and reports the named module", async () => {
      vi.mocked(apiRequest).mockResolvedValue({
        data: {
          modules: { payment: { enabled: true, customerId: "cus_1" } },
          allowed: ["payment"],
          plan: "pro",
        },
      });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "modules", "status", "payment", "--json"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/modules",
        expect.objectContaining({})
      );
      const printed = (logSpy.mock.calls[0]?.[0] as string) ?? "";
      const parsed = JSON.parse(printed) as { data?: { module?: string; enabled?: boolean; allowedForTier?: boolean } };
      expect(parsed.data?.module).toBe("payment");
      expect(parsed.data?.enabled).toBe(true);
      expect(parsed.data?.allowedForTier).toBe(true);
    });
  });
});

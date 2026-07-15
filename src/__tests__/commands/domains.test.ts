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
import { domains } from "../../commands/domains.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(domains);
  program.exitOverride();
  return program;
}

describe("domains commands", () => {
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
    it("calls GET /account/domains", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "domains", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/account/domains",
        expect.objectContaining({})
      );
      const call = vi.mocked(apiRequest).mock.calls[0]![1] ?? {};
      expect(call.method ?? "GET").toBe("GET");
    });
  });

  describe("add", () => {
    it("calls POST /account/domains with { domain }", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "dom_1", domain: "shop.example.com", status: "pending" });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "domains", "add", "shop.example.com"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/account/domains",
        expect.objectContaining({
          method: "POST",
          body: { domain: "shop.example.com" },
        })
      );
    });
  });

  describe("verify", () => {
    it("calls POST /account/domains/:id/verify", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "dom_1", status: "verified" });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "domains", "verify", "dom_abc"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/account/domains/dom_abc/verify",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("remove", () => {
    it("calls DELETE /account/domains/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "domains", "remove", "dom_abc"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/account/domains/dom_abc",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});

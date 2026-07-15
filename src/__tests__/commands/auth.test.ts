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
import { setConfig, clearConfig, getConfigPath } from "../../lib/config.js";
import { auth } from "../../commands/auth.js";

function createProgram() {
  const program = new Command();
  program.option("--json", "JSON output").option("--sandbox", "Sandbox mode");
  program.addCommand(auth);
  program.exitOverride(); // Throw instead of process.exit for commander errors
  return program;
}

describe("auth commands", () => {
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

  describe("auth login", () => {
    it("saves production key with sk_live_ prefix", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "auth", "login", "--key", "sk_live_abc123def456"]);

      expect(setConfig).toHaveBeenCalledWith({ token: "sk_live_abc123def456" });
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Production API key saved"))).toBe(true);
    });

    it("saves sandbox key with sk_test_ prefix", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "auth", "login", "--key", "sk_test_abc123def456"]);

      expect(setConfig).toHaveBeenCalledWith({ testApiKey: "sk_test_abc123def456" });
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Sandbox API key saved"))).toBe(true);
    });

    it("rejects invalid key prefix with exit code 1", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "auth", "login", "--key", "invalid_key"])
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("sk_live_ or sk_test_"))).toBe(true);
    });

    it("shows config path after successful login", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "auth", "login", "--key", "sk_live_xyz"]);

      expect(getConfigPath).toHaveBeenCalled();
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Config:"))).toBe(true);
    });
  });

  describe("auth logout", () => {
    it("clears config and prints confirmation", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "auth", "logout"]);

      expect(clearConfig).toHaveBeenCalled();
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Logged out"))).toBe(true);
    });
  });

  describe("auth whoami", () => {
    it("calls GET /account and displays account info", async () => {
      vi.mocked(apiRequest).mockResolvedValue({
        name: "Test Company",
        email: "dev@test.com",
        plan: "pro",
        slug: "test-co",
      });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "auth", "whoami"]);

      expect(apiRequest).toHaveBeenCalledWith("/account", expect.objectContaining({}));
      expect(logSpy).toHaveBeenCalled();
    });

    it("outputs JSON when --json flag is set", async () => {
      const accountData = { name: "Test", email: "dev@test.com", plan: "pro", slug: "test" };
      vi.mocked(apiRequest).mockResolvedValue(accountData);

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "auth", "whoami", "--json"]);

      const jsonOutput = logSpy.mock.calls.find((c) => {
        try { JSON.parse(String(c[0])); return true; } catch { return false; }
      });
      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(String(jsonOutput![0]));
      expect(parsed.name).toBe("Test");
    });

    it("exits with code 2 on 401 error", async () => {
      vi.mocked(apiRequest).mockRejectedValue(
        new ApiClientError({ status: 401, message: "Unauthorized", code: "INVALID_KEY" })
      );

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "auth", "whoami"])
      ).rejects.toThrow("process.exit(2)");
    });

    it("exits with code 3 on 429 rate limit", async () => {
      vi.mocked(apiRequest).mockRejectedValue(
        new ApiClientError({ status: 429, message: "Rate limited" })
      );

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "auth", "whoami"])
      ).rejects.toThrow("process.exit(3)");
    });
  });
});

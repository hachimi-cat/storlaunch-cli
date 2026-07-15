import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../../lib/config.js", () => ({
  setConfig: vi.fn(),
  clearConfig: vi.fn(),
  getConfig: vi.fn(() => ({
    api_url: "https://api.test/v1",
    token: "sk_live_fake_fixture_token_abc_1234",
    testApiKey: "sk_test_fake_fixture_token_xyz_5678",
  })),
  getConfigPath: vi.fn(() => "/tmp/.storlaunch/config.json"),
  resolveApiKey: vi.fn(() => "sk_live_test"),
  resolveApiUrl: vi.fn(() => "https://api.test/v1"),
}));

import { getConfig, setConfig } from "../../lib/config.js";
import { config } from "../../commands/config.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(config);
  program.exitOverride();
  return program;
}

describe("config commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.mocked(setConfig).mockReset();
    vi.mocked(getConfig).mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  describe("config set", () => {
    it("sets a simple key-value pair", async () => {
      vi.mocked(getConfig).mockReturnValue({ api_url: "https://api.test/v1", token: "sk_live_x" });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "config", "set", "api_url", "https://custom.api/v1"]);

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({ api_url: "https://custom.api/v1" })
      );
    });

    it("sets a dotted key (defaults.currency)", async () => {
      vi.mocked(getConfig).mockReturnValue({ api_url: "https://api.test/v1", token: "sk_live_x" });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "config", "set", "defaults.currency", "IDR"]);

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({ defaults: expect.objectContaining({ currency: "IDR" }) })
      );
    });

    it("outputs JSON when --json flag is set", async () => {
      vi.mocked(getConfig).mockReturnValue({ api_url: "https://api.test/v1", token: "sk_live_x" });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "config", "set", "api_url", "https://x.com", "--json"]);

      const jsonCall = logSpy.mock.calls.find((c) => {
        try { JSON.parse(String(c[0])); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(String(jsonCall![0]));
      expect(parsed.key).toBe("api_url");
    });
  });

  describe("config get", () => {
    it("returns the value for a key", async () => {
      vi.mocked(getConfig).mockReturnValue({ api_url: "https://api.test/v1", token: "sk_live_abc" });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "config", "get", "api_url"]);

      expect(logSpy).toHaveBeenCalledWith("https://api.test/v1");
    });

    it("exits with code 1 when key not found", async () => {
      vi.mocked(getConfig).mockReturnValue({ api_url: "https://api.test/v1", token: "sk_live_abc" });

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "config", "get", "nonexistent"])
      ).rejects.toThrow("process.exit(1)");

      expect(errorSpy.mock.calls.some((c) => String(c[0]).includes("not found"))).toBe(true);
    });

    it("exits with code 1 when no config exists", async () => {
      vi.mocked(getConfig).mockReturnValue(null);

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "config", "get", "api_url"])
      ).rejects.toThrow("process.exit(1)");
    });
  });

  describe("config list", () => {
    it("displays all config with masked tokens", async () => {
      vi.mocked(getConfig).mockReturnValue({
        api_url: "https://api.test/v1",
        token: "sk_live_fake_fixture_token_abc_1234",
        testApiKey: "sk_test_fake_fixture_token_xyz_5678",
      });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "config", "list"]);

      expect(logSpy).toHaveBeenCalled();
      // Token should be masked — check that full token is NOT in output
      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).not.toContain("sk_live_fake_fixture_token_abc_1234");
      expect(allOutput).toContain("..."); // Masked format
    });

    it("outputs full JSON when --json flag is set", async () => {
      vi.mocked(getConfig).mockReturnValue({
        api_url: "https://api.test/v1",
        token: "sk_live_abc",
      });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "config", "list", "--json"]);

      const jsonCall = logSpy.mock.calls.find((c) => {
        try { JSON.parse(String(c[0])); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
    });
  });
});

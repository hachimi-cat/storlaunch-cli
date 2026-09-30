import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../../lib/api.js", async (importOriginal) => {
  // The real URL joining (apiUrl); only the network call is mocked.
  const { apiUrl } = await importOriginal<typeof import("../../lib/api.js")>();
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
  return { apiRequest: vi.fn(), apiUrl, ApiClientError };
});

vi.mock("../../lib/config.js", () => ({
  setConfig: vi.fn(),
  clearConfig: vi.fn(),
  getConfig: vi.fn(() => ({ api_url: "https://api.test/v1", token: "sk_live_test" })),
  getConfigPath: vi.fn(() => "/tmp/.storlaunch/config.json"),
  resolveApiKey: vi.fn(() => "sk_live_test"),
  resolveApiUrl: vi.fn(() => "https://api.test/api/v1"),
}));

import { apiRequest } from "../../lib/api.js";
import { apiKeys } from "../../commands/api-keys.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(apiKeys);
  program.exitOverride();
  return program;
}

describe("api-keys commands", () => {
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
    it("calls GET /account/api-keys", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "api-keys", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/account/api-keys",
        expect.objectContaining({})
      );
      // Default method is GET (not explicitly passed)
      const call = vi.mocked(apiRequest).mock.calls[0]![1] ?? {};
      expect(call.method ?? "GET").toBe("GET");
    });
  });

  describe("create", () => {
    it("calls POST /account/api-keys with { description: name }", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "key_1", secret: "sk_live_one_shot" });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "api-keys", "create", "deploy-bot"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/account/api-keys",
        expect.objectContaining({
          method: "POST",
          body: { description: "deploy-bot" },
        })
      );
    });
  });

  describe("revoke", () => {
    it("calls DELETE /account/api-keys/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "api-keys", "revoke", "key_abc"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/account/api-keys/key_abc",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});

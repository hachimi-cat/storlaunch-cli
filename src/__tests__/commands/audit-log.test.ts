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
import { auditLog } from "../../commands/audit-log.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(auditLog);
  program.exitOverride();
  return program;
}

describe("audit-log commands", () => {
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
    it("calls GET /account/audit-log", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "audit-log", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/account/audit-log",
        expect.objectContaining({})
      );
      const call = vi.mocked(apiRequest).mock.calls[0]![1] ?? {};
      expect(call.method ?? "GET").toBe("GET");
    });

    it("forwards --limit, --since, and --event-type as query params", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "audit-log", "list",
        "--limit", "50",
        "--since", "2026-05-01T00:00:00Z",
        "--event-type", "api_key.created",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/account/audit-log",
        expect.objectContaining({
          query: expect.objectContaining({
            limit: 50,
            since: "2026-05-01T00:00:00Z",
            eventType: "api_key.created",
          }),
        })
      );
    });
  });
});

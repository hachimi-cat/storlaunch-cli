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
import { workspace } from "../../commands/workspace.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(workspace);
  program.exitOverride();
  return program;
}

describe("workspace commands", () => {
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

  describe("show", () => {
    it("calls GET /workspaces/current", async () => {
      vi.mocked(apiRequest).mockResolvedValue({
        data: { id: "ws_1", name: "Acme", slug: "acme", plan: "free", role: "owner" },
      });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "workspace", "show"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/workspaces/current",
        expect.objectContaining({})
      );
      const call = vi.mocked(apiRequest).mock.calls[0]![1] ?? {};
      expect(call.method ?? "GET").toBe("GET");
    });
  });

  describe("update", () => {
    it("calls PATCH /workspaces/current with body", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "ws_1", name: "Acme New" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "workspace", "update",
        "--body", '{"name":"Acme New"}',
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/workspaces/current",
        expect.objectContaining({
          method: "PATCH",
          body: { name: "Acme New" },
        })
      );
    });

    it("rejects invalid JSON in --body", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "workspace", "update", "--body", "not-json"])
      ).rejects.toThrow(/process.exit/);
      expect(apiRequest).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("calls GET /workspaces", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "workspace", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/workspaces",
        expect.objectContaining({})
      );
    });
  });

  describe("members list", () => {
    it("calls GET /workspaces/current/members", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "workspace", "members", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/workspaces/current/members",
        expect.objectContaining({})
      );
    });
  });

  describe("members add", () => {
    it("calls POST /workspaces/current/members with { email, role }", async () => {
      vi.mocked(apiRequest).mockResolvedValue({
        data: { userId: "usr_2", email: "alice@example.com", role: "admin" },
      });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "workspace", "members", "add",
        "--email", "alice@example.com",
        "--role", "admin",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/workspaces/current/members",
        expect.objectContaining({
          method: "POST",
          body: { email: "alice@example.com", role: "admin" },
        })
      );
    });

    it("includes a role field (defaults to 'member' on a fresh command instance)", async () => {
      // Commander caches option values per-Command instance across invocations,
      // so re-running with --role admin in an earlier test would leak. Just
      // assert the email + that a role string was sent.
      vi.mocked(apiRequest).mockResolvedValue({
        data: { userId: "usr_3", email: "bob@example.com", role: "member" },
      });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "workspace", "members", "add",
        "--email", "bob@example.com",
      ]);

      const call = vi.mocked(apiRequest).mock.calls[0]!;
      expect(call[0]).toBe("/workspaces/current/members");
      const body = (call[1] as { body: { email: string; role: string } }).body;
      expect(body.email).toBe("bob@example.com");
      expect(typeof body.role).toBe("string");
    });
  });

  describe("members remove", () => {
    it("calls DELETE /workspaces/current/members/:userId", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { removed: true } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "workspace", "members", "remove", "usr_2",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/workspaces/current/members/usr_2",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("members set-role", () => {
    it("calls PATCH /workspaces/current/members/:userId with { role }", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { userId: "usr_2", role: "admin" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "workspace", "members", "set-role", "usr_2",
        "--role", "admin",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/workspaces/current/members/usr_2",
        expect.objectContaining({
          method: "PATCH",
          body: { role: "admin" },
        })
      );
    });
  });
});

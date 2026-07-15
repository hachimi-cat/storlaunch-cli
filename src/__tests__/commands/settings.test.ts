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
import { settings } from "../../commands/settings.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(settings);
  program.exitOverride();
  return program;
}

describe("settings commands", () => {
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

  // ─── business ─────────────────────────────────────────────────────────────

  describe("business get", () => {
    it("calls GET /payment/plugipay-settings/checkout/settings", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { brandName: "Acme" } });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "settings", "business", "get"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/checkout/settings",
        expect.objectContaining({})
      );
      const call = vi.mocked(apiRequest).mock.calls[0]![1] ?? {};
      expect(call.method ?? "GET").toBe("GET");
    });
  });

  describe("business update", () => {
    it("calls PATCH /payment/plugipay-settings/checkout/settings with parsed JSON body", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { brandName: "Acme New" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "settings", "business", "update",
        "--body", '{"brandName":"Acme New"}',
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/checkout/settings",
        expect.objectContaining({
          method: "PATCH",
          body: { brandName: "Acme New" },
        })
      );
    });

    it("rejects non-JSON --body and exits non-zero", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "settings", "business", "update", "--body", "not-json"])
      ).rejects.toThrow(/process.exit/);
      expect(apiRequest).not.toHaveBeenCalled();
    });
  });

  // ─── providers ────────────────────────────────────────────────────────────

  describe("providers list", () => {
    it("calls GET /payment/plugipay-settings/adapters", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: {} });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "settings", "providers", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/adapters",
        expect.objectContaining({})
      );
    });
  });

  describe("providers get <kind>", () => {
    it("calls GET /payment/plugipay-settings/adapters then picks one entry", async () => {
      vi.mocked(apiRequest).mockResolvedValue({
        data: { xendit: { kind: "xendit", status: "active" }, paypal: null },
      });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "settings", "providers", "get", "xendit"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/adapters",
        expect.objectContaining({})
      );
    });

    it("rejects unknown provider kinds", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "settings", "providers", "get", "bogus"])
      ).rejects.toThrow(/process.exit/);
      expect(apiRequest).not.toHaveBeenCalled();
    });
  });

  describe("providers update <kind>", () => {
    it("calls PUT /payment/plugipay-settings/adapters/<kind> with body", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { kind: "xendit", status: "active" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "settings", "providers", "update", "xendit",
        "--body", '{"secretKey":"xnd_test_abc"}',
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/adapters/xendit",
        expect.objectContaining({
          method: "PUT",
          body: { secretKey: "xnd_test_abc" },
        })
      );
    });
  });

  // ─── templates ────────────────────────────────────────────────────────────

  describe("templates list", () => {
    it("calls GET /payment/plugipay-settings/templates with kind query when set", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "settings", "templates", "list", "--kind", "receipt",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/templates",
        expect.objectContaining({
          query: expect.objectContaining({ kind: "receipt" }),
        })
      );
    });
  });

  describe("templates get <id>", () => {
    it("calls GET /payment/plugipay-settings/templates/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "tpl_1" } });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "settings", "templates", "get", "tpl_1"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/templates/tpl_1",
        expect.objectContaining({})
      );
    });
  });

  describe("templates create", () => {
    it("calls POST /payment/plugipay-settings/templates with body", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "tpl_2" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "settings", "templates", "create",
        "--body", '{"kind":"receipt","name":"R1","config":{}}',
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/templates",
        expect.objectContaining({
          method: "POST",
          body: { kind: "receipt", name: "R1", config: {} },
        })
      );
    });
  });

  describe("templates update <id>", () => {
    it("calls PATCH /payment/plugipay-settings/templates/:id with body", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "tpl_1", name: "R1 new" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "settings", "templates", "update", "tpl_1",
        "--body", '{"name":"R1 new"}',
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/templates/tpl_1",
        expect.objectContaining({
          method: "PATCH",
          body: { name: "R1 new" },
        })
      );
    });
  });

  describe("templates make-default <id>", () => {
    it("calls POST /payment/plugipay-settings/templates/:id/make-default", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "tpl_1", isDefault: true } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "settings", "templates", "make-default", "tpl_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/templates/tpl_1/make-default",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("templates duplicate <id>", () => {
    it("calls POST /payment/plugipay-settings/templates/:id/duplicate", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "tpl_dup" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "settings", "templates", "duplicate", "tpl_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/templates/tpl_1/duplicate",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("templates delete <id>", () => {
    it("calls DELETE /payment/plugipay-settings/templates/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "settings", "templates", "delete", "tpl_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/plugipay-settings/templates/tpl_1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});

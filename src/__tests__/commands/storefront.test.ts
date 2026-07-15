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
import { storefront } from "../../commands/storefront.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(storefront);
  program.exitOverride();
  return program;
}

describe("storefront commands", () => {
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

  describe("products create", () => {
    it("calls POST /storefront/products with correct body", async () => {
      vi.mocked(apiRequest).mockResolvedValue({
        id: "prod_1", name: "UI Kit", price: 299000, currency: "IDR", slug: "ui-kit",
      });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "storefront", "products", "create",
        "--name", "UI Kit", "--price", "299000", "--currency", "IDR", "--slug", "ui-kit",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/storefront/products",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ name: "UI Kit", price: 299000, currency: "IDR", slug: "ui-kit" }),
        })
      );
    });
  });

  describe("products list", () => {
    it("calls GET /storefront/products", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [{ id: "prod_1", name: "Kit" }] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "storefront", "products", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/storefront/products",
        expect.objectContaining({ query: expect.any(Object) })
      );
    });

    it("outputs JSON with --json flag", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [{ id: "prod_1" }] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "storefront", "products", "list", "--json"]);

      const jsonCall = logSpy.mock.calls.find((c) => {
        try { JSON.parse(String(c[0])); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
    });
  });

  describe("products delete", () => {
    it("calls DELETE /storefront/products/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "storefront", "products", "delete", "prod_abc"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/storefront/products/prod_abc",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("products generate-description", () => {
    it("posts to /ai-generate then polls /:id until completed (default)", async () => {
      vi.mocked(apiRequest)
        // POST /ai-generate
        .mockResolvedValueOnce({ data: { message: "AI generation started" } })
        // GET /:id — completed on first poll
        .mockResolvedValueOnce({
          id: "prod_abc",
          aiStatus: "completed",
          description: "Shiny new description.",
          metadata: { seoTitle: "T", seoDescription: "D", featureBullets: ["a", "b"] },
        });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "storefront", "products", "generate-description", "prod_abc",
        "--timeout", "5",
      ]);

      expect(apiRequest).toHaveBeenNthCalledWith(
        1,
        "/storefront/products/prod_abc/ai-generate",
        expect.objectContaining({ method: "POST" }),
      );
      expect(apiRequest).toHaveBeenNthCalledWith(
        2,
        "/storefront/products/prod_abc",
        expect.objectContaining({}),
      );
    });

    it("with --no-wait, posts /ai-generate and exits without polling", async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: { message: "AI generation started" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "storefront", "products", "generate-description", "prod_abc",
        "--no-wait",
      ]);

      expect(apiRequest).toHaveBeenCalledTimes(1);
      expect(apiRequest).toHaveBeenCalledWith(
        "/storefront/products/prod_abc/ai-generate",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("emits queued JSON envelope with --no-wait --json", async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: { message: "AI generation started" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "--json", "storefront", "products", "generate-description", "prod_abc",
        "--no-wait",
      ]);

      const jsonCall = logSpy.mock.calls
        .map((c) => String(c[0]))
        .find((s) => {
          try {
            const parsed = JSON.parse(s);
            return parsed?.queued === true && parsed?.productId === "prod_abc";
          } catch {
            return false;
          }
        });
      expect(jsonCall).toBeDefined();
    });
  });

  describe("licenses list", () => {
    it("calls GET /storefront/licenses with filters", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "storefront", "licenses", "list",
        "--product", "prod_1", "--status", "active",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/storefront/licenses",
        expect.objectContaining({
          query: expect.objectContaining({ product: "prod_1", status: "active" }),
        })
      );
    });
  });

  describe("licenses revoke", () => {
    it("calls DELETE /storefront/licenses/:key", async () => {
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "storefront", "licenses", "revoke", "ABCD-1234"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/storefront/licenses/ABCD-1234",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("deliveries list", () => {
    it("calls GET /storefront/deliveries", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "storefront", "deliveries", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/storefront/deliveries",
        expect.objectContaining({ query: expect.any(Object) })
      );
    });
  });

  describe("error handling", () => {
    it("exits with code 1 on generic error", async () => {
      vi.mocked(apiRequest).mockRejectedValue(
        new ApiClientError({ status: 404, message: "Not found" })
      );

      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "storefront", "products", "get", "prod_none"])
      ).rejects.toThrow("process.exit(1)");
    });
  });
});

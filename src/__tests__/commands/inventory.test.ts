import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  resolveApiKey: vi.fn(() => "sk_live_test"),
  resolveApiUrl: vi.fn(() => "https://api.test/v1"),
}));

import { apiRequest } from "../../lib/api.js";
import { inventory } from "../../commands/inventory.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(inventory);
  program.exitOverride();
  return program;
}

describe("inventory commands", () => {
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

  describe("variants", () => {
    it("create POSTs /inventory/variants with productId + name", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "var_1", name: "Red / M" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "inventory", "variants", "create",
        "--product", "prod_1", "--name", "Red / M", "--sku", "RED-M", "--price-delta", "5000",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/variants",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            productId: "prod_1",
            name: "Red / M",
            sku: "RED-M",
            priceDelta: 5000,
          }),
        })
      );
    });

    it("list GETs /inventory/variants with productId query", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "inventory", "variants", "list", "--product", "prod_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/variants",
        expect.objectContaining({ query: expect.objectContaining({ productId: "prod_1" }) })
      );
    });

    it("update PATCHes /inventory/variants/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "var_1" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "inventory", "variants", "update", "var_1", "--name", "Red / L",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/variants/var_1",
        expect.objectContaining({ method: "PATCH", body: { name: "Red / L" } })
      );
    });

    it("delete calls DELETE /inventory/variants/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "inventory", "variants", "delete", "var_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/variants/var_1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("warehouses", () => {
    it("create POSTs /inventory/warehouses", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "wh_1", name: "Main" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "inventory", "warehouses", "create",
        "--name", "Main", "--city", "Jakarta", "--postal", "12190", "--default",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/warehouses",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ name: "Main", city: "Jakarta", postal: "12190", isDefault: true }),
        })
      );
    });

    it("list GETs /inventory/warehouses", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "inventory", "warehouses", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/warehouses",
        expect.anything()
      );
    });

    it("update PATCHes with new name", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: {} });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "inventory", "warehouses", "update", "wh_1", "--name", "Warehouse Utama",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/warehouses/wh_1",
        expect.objectContaining({ method: "PATCH", body: { name: "Warehouse Utama" } })
      );
    });
  });

  describe("stock", () => {
    it("adjust POSTs /inventory/adjust with signed delta", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "mv_1", delta: -3 } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "inventory", "stock", "adjust",
        "--variant", "var_1", "--warehouse", "wh_1", "--delta", "-3",
        "--reason", "damaged", "--note", "broken on receipt",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/adjust",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            variantId: "var_1",
            warehouseId: "wh_1",
            delta: -3,
            reason: "damaged",
            note: "broken on receipt",
          }),
        })
      );
    });

    it("history GETs /inventory/movements with filters", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "inventory", "stock", "history",
        "--variant", "var_1", "--limit", "10",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/movements",
        expect.objectContaining({
          query: expect.objectContaining({ variantId: "var_1", limit: 10 }),
        })
      );
    });

    it("alerts GETs /inventory/low-stock", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "inventory", "stock", "alerts"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/low-stock",
        expect.anything()
      );
    });

    it("import reads file and POSTs /inventory/import", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { imported: 2, skipped: 0, errors: [] } });

      const dir = mkdtempSync(join(tmpdir(), "cli-inv-"));
      const csvPath = join(dir, "stock.csv");
      writeFileSync(csvPath, "sku,name,productSlug,warehouseId,quantity\nABC,Red,ui-kit,wh_1,10\n");

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "inventory", "stock", "import", "--file", csvPath,
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/inventory/import",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ csv: expect.stringContaining("sku,name,productSlug") }),
        })
      );
    });
  });
});

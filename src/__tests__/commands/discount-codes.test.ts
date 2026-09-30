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
  resolveApiKey: vi.fn(() => "sk_live_test"),
  resolveApiUrl: vi.fn(() => "https://api.test/api/v1"),
}));

import { apiRequest } from "../../lib/api.js";
import { discountCodes } from "../../commands/discount-codes.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(discountCodes);
  program.exitOverride();
  return program;
}

describe("discount-codes commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.mocked(apiRequest).mockReset();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { valid: true, discountAmount: 20000, discountShipping: 0 } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("list GETs /discount-codes with active filter", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });
    const program = createProgram();
    await program.parseAsync(["node", "storlaunch", "discount-codes", "list", "--active"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/discount-codes",
      expect.objectContaining({ query: expect.objectContaining({ active: "true" }) })
    );
  });

  it("create POSTs with type + value + scope + tags", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "dc_1", code: "SUMMER20" } });
    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "discount-codes", "create",
      "--code", "summer20", "--type", "percent", "--value", "20",
      "--currency", "IDR", "--scope", "tags", "--tags", "summer,sale",
      "--min-purchase", "100000", "--max-uses", "100",
    ]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/discount-codes",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          code: "summer20",
          type: "percent",
          value: 20,
          currency: "IDR",
          scope: "tags",
          tagFilter: ["summer", "sale"],
          minPurchaseAmount: 100000,
          maxUsesTotal: 100,
        }),
      })
    );
  });

  it("update PATCHes /discount-codes/:id", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {} });
    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "discount-codes", "update", "dc_1", "--inactive",
    ]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/discount-codes/dc_1",
      expect.objectContaining({ method: "PATCH", body: { active: false } })
    );
  });

  it("delete calls DELETE", async () => {
    vi.mocked(apiRequest).mockResolvedValue(undefined);
    const program = createProgram();
    await program.parseAsync(["node", "storlaunch", "discount-codes", "delete", "dc_1"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/discount-codes/dc_1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("validate uses raw fetch against /storefront/public/validate-discount", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node", "storlaunch", "discount-codes", "validate",
      "--merchant", "my-shop", "--code", "SUMMER20",
      "--subtotal", "100000", "--currency", "IDR",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/storefront/public/validate-discount"),
      expect.objectContaining({ method: "POST" })
    );
  });
});

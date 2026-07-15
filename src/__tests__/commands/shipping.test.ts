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
  resolveApiKey: vi.fn(() => "sk_live_test"),
  resolveApiUrl: vi.fn(() => "https://api.test/v1"),
}));

import { apiRequest } from "../../lib/api.js";
import { shipping } from "../../commands/shipping.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(shipping);
  program.exitOverride();
  return program;
}

describe("shipping commands", () => {
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
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  describe("origin", () => {
    it("get hits GET /shipping/origin", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { configured: true } });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "shipping", "origin", "get"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/shipping/origin",
        expect.anything()
      );
    });

    it("set PATCHes /shipping/origin with couriers array", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { configured: true } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "shipping", "origin", "set",
        "--address", "Jl. Test 1",
        "--contact-name", "Adhya",
        "--contact-phone", "0811111",
        "--city", "Jakarta",
        "--postal", "12190",
        "--lat", "-6.2",
        "--lng", "106.8",
        "--couriers", "jne,jnt,sicepat",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/shipping/origin",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({
            address: "Jl. Test 1",
            contactName: "Adhya",
            contactPhone: "0811111",
            city: "Jakarta",
            postal: "12190",
            lat: -6.2,
            lng: 106.8,
            couriers: ["jne", "jnt", "sicepat"],
          }),
        })
      );
    });
  });

  describe("couriers", () => {
    it("list fetches /shipping/couriers without auth", async () => {
      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "shipping", "couriers", "list"]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/shipping/couriers"),
        expect.anything()
      );
    });
  });

  describe("areas", () => {
    it("search GETs /shipping/areas?q=", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "shipping", "areas", "search", "Bengkulu",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/shipping/areas",
        expect.objectContaining({ query: expect.objectContaining({ q: "Bengkulu" }) })
      );
    });
  });

  describe("shipments", () => {
    it("list GETs /shipping/shipments with status filter", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "shipping", "shipments", "list", "--status", "delivered",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/shipping/shipments",
        expect.objectContaining({ query: expect.objectContaining({ status: "delivered" }) })
      );
    });

    it("cancel POSTs /shipping/shipments/:id/cancel", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { id: "shp_1", status: "cancelled" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "shipping", "shipments", "cancel", "shp_1", "--reason", "buyer changed mind",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/shipping/shipments/shp_1/cancel",
        expect.objectContaining({ method: "POST", body: { reason: "buyer changed mind" } })
      );
    });

    it("label GETs /shipping/shipments/:id/label", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: { url: "https://biteship.com/label.pdf" } });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "shipping", "shipments", "label", "shp_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/shipping/shipments/shp_1/label",
        expect.anything()
      );
    });
  });

  describe("track", () => {
    it("fetches /shipping/track/:waybill", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "shipping", "track", "JX123", "--courier", "jne",
      ]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/shipping/track/JX123"),
        expect.anything()
      );
      expect(fetchSpy.mock.calls[0]![0]).toContain("courier=jne");
    });
  });
});

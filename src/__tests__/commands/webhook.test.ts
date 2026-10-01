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
import { webhook } from "../../commands/webhook.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(webhook);
  program.exitOverride();
  return program;
}

describe("webhook commands", () => {
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

  describe("endpoints create", () => {
    it("calls POST /payment/webhook-endpoints with url and events", async () => {
      vi.mocked(apiRequest).mockResolvedValue({
        id: "we_1", url: "https://myapp.com/wh", events: ["checkout.session.completed"], secret: "whsec_test",
      });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "webhook", "endpoints", "create",
        "--url", "https://myapp.com/wh", "--events", "checkout.session.completed,payment.succeeded",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/webhook-endpoints",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            url: "https://myapp.com/wh",
            events: ["checkout.session.completed", "payment.succeeded"],
          }),
        })
      );
    });

    it("handles wildcard events", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "we_1", url: "https://myapp.com/wh", events: ["*"] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "webhook", "endpoints", "create",
        "--url", "https://myapp.com/wh", "--events", "*",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/webhook-endpoints",
        expect.objectContaining({
          body: expect.objectContaining({ events: ["*"] }),
        })
      );
    });
  });

  describe("endpoints list", () => {
    it("calls GET /payment/webhook-endpoints", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "webhook", "endpoints", "list"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/webhook-endpoints",
        expect.objectContaining({})
      );
    });
  });

  describe("endpoints delete", () => {
    it("calls DELETE /payment/webhook-endpoints/:id", async () => {
      vi.mocked(apiRequest).mockResolvedValue(undefined);

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "webhook", "endpoints", "delete", "we_abc"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/webhook-endpoints/we_abc",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("events list", () => {
    it("calls GET /payment/webhook-events with filters", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: [] });

      const program = createProgram();
      await program.parseAsync([
        "node", "storlaunch", "webhook", "events", "list",
        "--type", "checkout.session.completed", "--status", "sent", "--endpoint", "we_1",
      ]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/webhook-events",
        expect.objectContaining({
          // the API filters on endpointId (it ignored `endpoint`)
          query: expect.objectContaining({ type: "checkout.session.completed", status: "sent", endpointId: "we_1" }),
        })
      );
    });
  });

  describe("endpoints test / event-types / update --rotate-secret", () => {
    it("queues a test event", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "whd_1", eventId: "evt_test_1", status: "pending" });
      await createProgram().parseAsync(["node", "storlaunch", "webhook", "endpoints", "test", "we_1"]);
      expect(apiRequest).toHaveBeenCalledWith("/payment/webhook-endpoints/we_1/test", expect.objectContaining({ method: "POST" }));
    });
    it("lists the event types", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ storlaunch: [{ type: "product.purchased", description: "x" }], plugipay: [] });
      await createProgram().parseAsync(["node", "storlaunch", "webhook", "endpoints", "event-types"]);
      expect(apiRequest).toHaveBeenCalledWith("/payment/webhook-endpoints/event-types", expect.anything());
    });
    it("rotates the secret and prints the new one", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "we_1", secret: "whsec_new" });
      await createProgram().parseAsync(["node", "storlaunch", "webhook", "endpoints", "update", "we_1", "--rotate-secret"]);
      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/webhook-endpoints/we_1",
        expect.objectContaining({ method: "PATCH", body: { rotateSecret: true } }),
      );
      expect(logSpy.mock.calls.flat().join(" ")).toContain("whsec_new");
    });
    it("subscribes to everything when --events is left out", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "we_1", url: "https://myapp.com/wh", events: ["*"] });
      await createProgram().parseAsync(["node", "storlaunch", "webhook", "endpoints", "create", "--url", "https://myapp.com/wh"]);
      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/webhook-endpoints",
        expect.objectContaining({ body: expect.objectContaining({ events: ["*"] }) }),
      );
    });
  });

  describe("events resend", () => {
    it("calls POST /payment/webhook-events/:id/resend", async () => {
      vi.mocked(apiRequest).mockResolvedValue({ id: "evt_1", status: "resent" });

      const program = createProgram();
      await program.parseAsync(["node", "storlaunch", "webhook", "events", "resend", "evt_abc"]);

      expect(apiRequest).toHaveBeenCalledWith(
        "/payment/webhook-events/evt_abc/resend",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("listen", () => {
    it("exits with code 0 (stubbed for MVP)", async () => {
      const program = createProgram();
      await expect(
        program.parseAsync(["node", "storlaunch", "webhook", "listen"])
      ).rejects.toThrow("process.exit(0)");
    });
  });
});

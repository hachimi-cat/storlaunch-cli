import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../lib/api.js", () => {
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

import { apiRequest, ApiClientError } from "../lib/api.js";
import { buildApiCommand, API_ROUTES } from "../commands/api.generated.js";

// `storlaunch api <area> <action>`: every feature route, generated from the API spec.
function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(buildApiCommand());
  program.exitOverride();
  return program;
}

describe("storlaunch api", () => {
  let exits: Array<number | string | null | undefined>;
  const spies: Array<{ mockRestore(): void }> = [];

  beforeEach(() => {
    exits = [];
    spies.push(vi.spyOn(console, "log").mockImplementation(() => {}));
    spies.push(vi.spyOn(console, "error").mockImplementation(() => {}));
    spies.push(
      vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
        exits.push(code);
      }) as never),
    );
    vi.mocked(apiRequest).mockReset();
  });

  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
  });

  it("has a command for every feature route", () => {
    const count = API_ROUTES.reduce((n, a) => n + a.routes.length, 0);
    expect(count).toBeGreaterThan(290);
    const areas = API_ROUTES.map((a) => a.area);
    expect(areas).toEqual(expect.arrayContaining(["discount-codes", "storefront", "payment", "workspaces", "uploads"]));
  });

  it("creates a discount code from flags, typed as the spec says, through the CLI's own client", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { id: "dc_1" } });
    await createProgram().parseAsync([
      "node", "storlaunch", "--sandbox", "api", "discount-codes", "create",
      "--code", "SPRING10", "--type", "percent", "--value", "10", "--currency", "IDR", "--public", "false",
    ]);
    expect(apiRequest).toHaveBeenCalledWith("/api/v1/discount-codes", {
      method: "POST",
      query: {},
      body: { code: "SPRING10", type: "percent", value: 10, currency: "IDR", public: false },
      sandbox: true,
    });
    expect(exits[0]).toBe(0);
  });

  it("refuses a value the spec does not allow, and a missing required field", async () => {
    await createProgram().parseAsync([
      "node", "storlaunch", "api", "discount-codes", "create", "--code", "X", "--type", "percentage", "--value", "1", "--currency", "IDR",
    ]);
    await createProgram().parseAsync(["node", "storlaunch", "api", "discount-codes", "create", "--code", "X"]);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(exits).toEqual([1, 1]);
  });

  it("puts path parameters in the path and query fields in the query", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });
    await createProgram().parseAsync(["node", "storlaunch", "api", "discount-codes", "get", "dc 1"]);
    expect(apiRequest).toHaveBeenLastCalledWith("/api/v1/discount-codes/dc%201", expect.objectContaining({ method: "GET", query: {} }));
    await createProgram().parseAsync(["node", "storlaunch", "api", "discount-codes", "list", "--limit", "5"]);
    expect(apiRequest).toHaveBeenLastCalledWith("/api/v1/discount-codes", expect.objectContaining({ query: { limit: "5" } }));
  });

  it("exits 2 on an auth error, like the hand-written commands", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new ApiClientError({ status: 401, message: "Authentication required" }));
    await createProgram().parseAsync(["node", "storlaunch", "api", "workspaces", "current"]);
    expect(exits[0]).toBe(2);
  });
});

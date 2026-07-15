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

vi.mock("../../lib/buyer-api.js", () => {
  class BuyerApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.name = "BuyerApiError";
      this.status = status;
      this.code = code;
    }
  }
  return { buyerRequest: vi.fn(), BuyerApiError };
});

vi.mock("../../lib/buyer-config.js", () => ({
  requireBuyerSession: vi.fn(() => ({ accountSlug: "shop", email: "b@t.co", token: "x", expiresAt: "2030-01-01" })),
}));

import { apiRequest } from "../../lib/api.js";
import { buyerRequest } from "../../lib/buyer-api.js";
import { referralProgram, buyReferral } from "../../commands/referrals.js";

function createSellProgram() {
  const p = new Command();
  p.option("--json").option("--sandbox");
  p.addCommand(referralProgram);
  p.exitOverride();
  return p;
}

function createBuyProgram() {
  const p = new Command();
  p.option("--json").option("--sandbox");
  p.addCommand(buyReferral);
  p.exitOverride();
  return p;
}

describe("sell referral-program", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.mocked(apiRequest).mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("get fetches /account/referrals", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: {
        enabled: true, rewardType: "percent", referrerValue: 10, refereeValue: 15,
        currency: "IDR", minPurchaseAmount: null, rewardExpiryDays: 90,
        attributionWindowDays: 30, maxRewardsPerReferrer: null, programTerms: null,
      },
    } as unknown as never);
    const p = createSellProgram();
    await p.parseAsync(["node", "cli", "referral-program", "get"]);
    expect(apiRequest).toHaveBeenCalledWith("/account/referrals", expect.objectContaining({ sandbox: undefined }));
  });

  it("update --enable --referrer-value 15 PUTs with merged fields", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        data: {
          enabled: false, rewardType: "percent", referrerValue: 10, refereeValue: 10,
          currency: "IDR", minPurchaseAmount: null, rewardExpiryDays: 90,
          attributionWindowDays: 30, maxRewardsPerReferrer: null, programTerms: null,
        },
      } as unknown as never)
      .mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createSellProgram();
    await p.parseAsync(["node", "cli", "referral-program", "update", "--enable", "--referrer-value", "15"]);
    expect(apiRequest).toHaveBeenLastCalledWith(
      "/account/referrals",
      expect.objectContaining({
        method: "PUT",
        body: expect.objectContaining({ enabled: true, referrerValue: 15, refereeValue: 10 }),
      }),
    );
  });

  it("links fetches /account/referrals/links", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { rows: [], nextCursor: null } } as unknown as never);
    const p = createSellProgram();
    await p.parseAsync(["node", "cli", "referral-program", "links", "--limit", "50"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/referrals/links",
      expect.objectContaining({ query: { limit: "50" } }),
    );
  });

  it("attributions passes --status filter through to query", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { rows: [], nextCursor: null } } as unknown as never);
    const p = createSellProgram();
    await p.parseAsync(["node", "cli", "referral-program", "attributions", "--status", "pending"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/referrals/attributions",
      expect.objectContaining({ query: expect.objectContaining({ status: "pending" }) }),
    );
  });

  it("stats fetches /account/referrals/stats", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: { totalLinks: 0, totalClicks: 0, totalSignups: 0, totalRewards: 0, attributedRevenue: 0, conversionRate: 0 },
    } as unknown as never);
    const p = createSellProgram();
    await p.parseAsync(["node", "cli", "referral-program", "stats"]);
    expect(apiRequest).toHaveBeenCalledWith("/account/referrals/stats", expect.objectContaining({ sandbox: undefined }));
  });
});

describe("buy referral", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(buyerRequest).mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("get-link --merchant hits /checkout/referrals/my-link", async () => {
    vi.mocked(buyerRequest).mockResolvedValueOnce({
      data: { enabled: true, code: "abcd1234", url: "https://x/r/abcd1234", stats: { clicks: 2, signups: 1, rewards: 0 } },
    } as unknown as never);
    const p = createBuyProgram();
    await p.parseAsync(["node", "cli", "referral", "get-link", "--merchant", "shop"]);
    expect(buyerRequest).toHaveBeenCalledWith(
      "shop",
      "/checkout/referrals/my-link",
      expect.objectContaining({ method: "GET", query: { accountSlug: "shop" } }),
    );
  });

  it("rewards --merchant hits /checkout/referrals/my-rewards", async () => {
    vi.mocked(buyerRequest).mockResolvedValueOnce({ data: [] } as unknown as never);
    const p = createBuyProgram();
    await p.parseAsync(["node", "cli", "referral", "rewards", "--merchant", "shop"]);
    expect(buyerRequest).toHaveBeenCalledWith(
      "shop",
      "/checkout/referrals/my-rewards",
      expect.objectContaining({ method: "GET", query: { accountSlug: "shop" } }),
    );
  });
});

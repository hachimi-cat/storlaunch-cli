import { Command } from "commander";
import chalk from "chalk";
import { apiRequest } from "../lib/api.js";
import { buyerRequest, BuyerApiError } from "../lib/buyer-api.js";
import { requireBuyerSession } from "../lib/buyer-config.js";
import { output } from "../lib/output.js";

/**
 * Referral program commands (Phase F.5).
 *
 *   sell referral-program get/update/links/attributions/stats
 *   buy  referral get-link/rewards
 */

// ─── sell referral-program ───────────────────────────────────────────────

export const referralProgram = new Command("referral-program").description(
  "Configure per-merchant referral program + inspect links / attributions / stats",
);

interface ProgramConfig {
  enabled: boolean;
  rewardType: "percent" | "fixed" | "shipping_percent" | "shipping_fixed";
  referrerValue: number;
  refereeValue: number;
  currency: string;
  minPurchaseAmount: number | null;
  rewardExpiryDays: number;
  attributionWindowDays: number;
  maxRewardsPerReferrer: number | null;
  programTerms: string | null;
}

interface ProgramStats {
  totalLinks: number;
  totalClicks: number;
  totalSignups: number;
  totalRewards: number;
  attributedRevenue: number;
  conversionRate: number;
}

interface LinkRow {
  id: string;
  code: string;
  clicks: number;
  signups: number;
  rewards: number;
  revenue: number;
  customer?: { email: string; name: string | null };
}

interface AttributionRow {
  id: string;
  status: "pending" | "rewarded" | "voided" | "expired";
  clickedAt: string;
  rewardedAt: string | null;
  voidReason: string | null;
  referrerCustomer?: { email: string };
  refereeCustomer?: { email: string };
  link?: { code: string };
}

function handleError(err: unknown, json?: boolean): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (json) output({ error: { message: msg } }, { json: true });
  else console.error(chalk.red(`Error: ${msg}`));
  process.exit(1);
}

referralProgram
  .command("get")
  .description("Show current program config")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<ProgramConfig>("/account/referrals", { sandbox: g.sandbox });
      const data = (result as unknown as { data?: ProgramConfig }).data ?? (result as unknown as ProgramConfig);
      if (g.json) output(result, { json: true });
      else {
        console.log(`Enabled:                ${data.enabled ? chalk.green("yes") : chalk.red("no")}`);
        console.log(`Reward type:            ${data.rewardType}`);
        console.log(`Referrer reward:        ${formatReward(data.rewardType, data.referrerValue, data.currency)}`);
        console.log(`Referee reward:         ${formatReward(data.rewardType, data.refereeValue, data.currency)}`);
        console.log(`Currency:               ${data.currency}`);
        console.log(`Min purchase:           ${data.minPurchaseAmount != null ? formatCurrency(data.minPurchaseAmount, data.currency) : chalk.dim("(none)")}`);
        console.log(`Reward expires after:   ${data.rewardExpiryDays} days`);
        console.log(`Attribution window:     ${data.attributionWindowDays} days`);
        console.log(`Max rewards per referrer: ${data.maxRewardsPerReferrer ?? chalk.dim("unlimited")}`);
        if (data.programTerms) console.log(`Terms:\n${chalk.dim(data.programTerms)}`);
      }
    } catch (err) { handleError(err, g.json); }
  });

referralProgram
  .command("update")
  .description("Update program fields (only flags you pass are changed)")
  .option("--enable", "Enable the program")
  .option("--disable", "Disable the program")
  .option("--reward-type <type>", "percent | fixed | shipping_percent | shipping_fixed")
  .option("--referrer-value <n>", "Reward value for the referrer", (v) => parseInt(v, 10))
  .option("--referee-value <n>", "Reward value for the new buyer", (v) => parseInt(v, 10))
  .option("--currency <code>", "Currency (e.g. IDR, USD)")
  .option("--min-purchase <n>", "Min purchase amount in smallest unit", (v) => parseInt(v, 10))
  .option("--no-min-purchase", "Clear the min purchase floor")
  .option("--reward-expiry-days <n>", "Reward code TTL in days", (v) => parseInt(v, 10))
  .option("--attribution-window-days <n>", "Attribution window in days", (v) => parseInt(v, 10))
  .option("--max-rewards-per-referrer <n>", "Per-referrer lifetime cap", (v) => parseInt(v, 10))
  .option("--no-max-rewards-per-referrer", "Remove the per-referrer cap")
  .option("--terms <text>", "Fine-print terms shown to buyers")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      // Fetch current so we can merge — the API PUT replaces required fields.
      const current = await apiRequest<ProgramConfig>("/account/referrals", { sandbox: g.sandbox });
      const cur = (current as unknown as { data?: ProgramConfig }).data ?? (current as unknown as ProgramConfig);

      const body: Record<string, unknown> = {
        rewardType: opts.rewardType ?? cur.rewardType,
        referrerValue: opts.referrerValue ?? cur.referrerValue,
        refereeValue: opts.refereeValue ?? cur.refereeValue,
        currency: opts.currency ?? cur.currency,
      };
      if (opts.enable) body.enabled = true;
      else if (opts.disable) body.enabled = false;
      else body.enabled = cur.enabled;

      if (opts.minPurchase === false) body.minPurchaseAmount = null;
      else if (opts.minPurchase !== undefined) body.minPurchaseAmount = opts.minPurchase;
      else body.minPurchaseAmount = cur.minPurchaseAmount;

      if (opts.rewardExpiryDays !== undefined) body.rewardExpiryDays = opts.rewardExpiryDays;
      if (opts.attributionWindowDays !== undefined) body.attributionWindowDays = opts.attributionWindowDays;

      if (opts.maxRewardsPerReferrer === false) body.maxRewardsPerReferrer = null;
      else if (opts.maxRewardsPerReferrer !== undefined) body.maxRewardsPerReferrer = opts.maxRewardsPerReferrer;
      else body.maxRewardsPerReferrer = cur.maxRewardsPerReferrer;

      if (opts.terms !== undefined) body.programTerms = opts.terms || null;

      const result = await apiRequest<ProgramConfig>("/account/referrals", {
        method: "PUT",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) output(result, { json: true });
      else console.log(chalk.green("Program saved."));
    } catch (err) { handleError(err, g.json); }
  });

referralProgram
  .command("links")
  .description("Top referrer links (sorted by rewards, newest tiebreak)")
  .option("--limit <n>", "Limit rows (max 200)", (v) => parseInt(v, 10), 20)
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<{ rows: LinkRow[]; nextCursor: string | null }>(
        "/account/referrals/links",
        { query: { limit: String(opts.limit) }, sandbox: g.sandbox },
      );
      const rows = (result as unknown as { data?: { rows: LinkRow[] } }).data?.rows ?? [];
      if (g.json) output(result, { json: true });
      else if (rows.length === 0) console.log(chalk.dim("No referral links yet."));
      else {
        console.log(chalk.bold("code      email                             clicks  signups  rewards  revenue"));
        for (const r of rows) {
          const email = (r.customer?.email ?? "—").padEnd(33).slice(0, 33);
          console.log(
            `${r.code.padEnd(9)} ${email}  ${String(r.clicks).padStart(6)}  ${String(r.signups).padStart(7)}  ${String(r.rewards).padStart(7)}  ${r.revenue > 0 ? formatCurrency(r.revenue, "IDR") : "—"}`,
          );
        }
      }
    } catch (err) { handleError(err, g.json); }
  });

referralProgram
  .command("attributions")
  .description("Recent attribution lifecycle rows")
  .option("--limit <n>", "Limit rows (max 200)", (v) => parseInt(v, 10), 20)
  .option("--status <status>", "Filter: pending | rewarded | voided | expired")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const query: Record<string, string> = { limit: String(opts.limit) };
      if (opts.status) query.status = opts.status;
      const result = await apiRequest<{ rows: AttributionRow[]; nextCursor: string | null }>(
        "/account/referrals/attributions",
        { query, sandbox: g.sandbox },
      );
      const rows = (result as unknown as { data?: { rows: AttributionRow[] } }).data?.rows ?? [];
      if (g.json) output(result, { json: true });
      else if (rows.length === 0) console.log(chalk.dim("No attributions yet."));
      else {
        console.log(chalk.bold("clicked              status      code      referrer                            referee"));
        for (const r of rows) {
          const when = new Date(r.clickedAt).toISOString().slice(0, 16).replace("T", " ");
          const status = r.status === "rewarded" ? chalk.green(r.status) : r.status === "pending" ? chalk.yellow(r.status) : chalk.dim(r.status);
          const referrer = (r.referrerCustomer?.email ?? "—").padEnd(33).slice(0, 33);
          const referee = (r.refereeCustomer?.email ?? "—").padEnd(33).slice(0, 33);
          console.log(`${when}  ${status.padEnd(16)} ${(r.link?.code ?? "—").padEnd(9)} ${referrer}  ${referee}`);
        }
      }
    } catch (err) { handleError(err, g.json); }
  });

referralProgram
  .command("stats")
  .description("Program stats (clicks, signups, rewards, attributed revenue)")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<ProgramStats>("/account/referrals/stats", { sandbox: g.sandbox });
      const stats = (result as unknown as { data?: ProgramStats }).data ?? (result as unknown as ProgramStats);
      if (g.json) output(result, { json: true });
      else {
        console.log(`Links issued:       ${chalk.bold(stats.totalLinks)}`);
        console.log(`Clicks:             ${chalk.bold(stats.totalClicks)}`);
        console.log(`Signups:            ${chalk.bold(stats.totalSignups)}`);
        console.log(`Rewards issued:     ${chalk.bold(stats.totalRewards)}`);
        console.log(`Attributed revenue: ${formatCurrency(stats.attributedRevenue, "IDR")}`);
        console.log(`Conversion rate:    ${chalk.bold((stats.conversionRate * 100).toFixed(1))}% ${chalk.dim("(rewards / clicks)")}`);
      }
    } catch (err) { handleError(err, g.json); }
  });

// ─── buy referral ────────────────────────────────────────────────────────

export const buyReferral = new Command("referral").description("Your referral link + earned reward codes");

interface MyLink {
  enabled: boolean;
  code?: string;
  url?: string;
  stats?: { clicks: number; signups: number; rewards: number };
}

interface MyReward {
  role: string;
  code: string;
  discountType: string;
  value: number;
  currency: string;
  expiresAt: string | null;
  redeemed: boolean;
  active: boolean;
}

buyReferral
  .command("get-link")
  .description("Show your unique referral link for a merchant")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (opts: { merchant: string }, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest<MyLink>(opts.merchant, "/checkout/referrals/my-link", {
        method: "GET",
        query: { accountSlug: opts.merchant },
      });
      if (g.json) output({ data }, { json: true });
      else if (!data?.enabled) console.log(chalk.dim("This merchant hasn't enabled referrals yet."));
      else {
        console.log(`Link:       ${chalk.bold(data.url ?? "—")}`);
        console.log(`Code:       ${chalk.bold(data.code ?? "—")}`);
        console.log(chalk.dim("Stats:"));
        console.log(`  Clicks:   ${data.stats?.clicks ?? 0}`);
        console.log(`  Signups:  ${data.stats?.signups ?? 0}`);
        console.log(`  Rewards:  ${data.stats?.rewards ?? 0}`);
      }
    } catch (err) { errExit(err); }
  });

buyReferral
  .command("rewards")
  .description("List reward codes you've earned from referrals")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .action(async (opts: { merchant: string }, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      requireBuyerSession(opts.merchant);
      const { data } = await buyerRequest<MyReward[]>(opts.merchant, "/checkout/referrals/my-rewards", {
        method: "GET",
        query: { accountSlug: opts.merchant },
      });
      const rewards = data ?? [];
      if (g.json) output({ data: rewards }, { json: true });
      else if (rewards.length === 0) console.log(chalk.dim("No rewards yet."));
      else {
        console.log(chalk.bold("code             role       reward                           expires      status"));
        for (const r of rewards) {
          const reward = formatReward(r.discountType, r.value, r.currency).padEnd(32);
          const expires = r.expiresAt ? new Date(r.expiresAt).toISOString().slice(0, 10) : "—";
          const status = r.redeemed ? chalk.green("used") : r.active ? chalk.yellow("active") : chalk.dim("expired");
          console.log(`${r.code.padEnd(16)} ${r.role.padEnd(10)} ${reward} ${expires.padEnd(12)} ${status}`);
        }
      }
    } catch (err) { errExit(err); }
  });

// ─── helpers ─────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "id-ID", {
    style: "currency", currency, minimumFractionDigits: 0,
  }).format(amount);
}

function formatReward(type: string, value: number, currency: string): string {
  if (type === "percent") return `${value}% off cart`;
  if (type === "shipping_percent") return `${value}% off shipping`;
  if (type === "fixed") return `${formatCurrency(value, currency)} off cart`;
  return `${formatCurrency(value, currency)} off shipping`;
}

function errExit(err: unknown): never {
  if (err instanceof BuyerApiError) {
    if (err.status === 401) console.error(chalk.red("Not signed in — run: storlaunch buy auth login --merchant <slug>"));
    else console.error(chalk.red(`${err.message} (HTTP ${err.status})`));
  } else {
    console.error(chalk.red((err as Error).message));
  }
  process.exit(1);
}

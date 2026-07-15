import { Command } from "commander";
import chalk from "chalk";
import { apiRequest } from "../lib/api.js";
import { output } from "../lib/output.js";

/**
 * `sell abandoned-cart` — manage abandoned-cart recovery automation.
 * Matches /dashboard/marketing/abandoned-cart 1:1.
 */

export const abandonedCart = new Command("abandoned-cart").description(
  "Configure abandoned-cart recovery emails + inspect reminders / recovery stats",
);

interface Config {
  enabled: boolean;
  delayHours: number;
  emailSubject: string;
  emailPreview: string;
  discountCodeId: string | null;
}

interface Reminder {
  id: string;
  email: string;
  sentAt: string;
  recoveredAt: string | null;
  valueAtSend: number;
  currencyAtSend: string;
  cartSnapshot: Array<{ name: string; quantity: number }>;
}

interface Stats {
  remindersSent: number;
  cartsRecovered: number;
  recoveryRate: number;
  recoveredRevenue: number;
  currency: string | null;
}

function handleError(err: unknown, json?: boolean): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (json) output({ error: { message: msg } }, { json: true });
  else console.error(chalk.red(`Error: ${msg}`));
  process.exit(1);
}

const config = new Command("config").description("Get / update config");

config
  .command("get")
  .description("Show current abandoned-cart config")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Config>("/account/abandoned-cart", { sandbox: g.sandbox });
      const data = (result as unknown as { data?: Config }).data ?? (result as unknown as Config);
      if (g.json) output(result, { json: true });
      else {
        console.log(`Enabled:      ${data.enabled ? chalk.green("yes") : chalk.red("no")}`);
        console.log(`Delay:        ${data.delayHours}h`);
        console.log(`Subject:      ${data.emailSubject}`);
        console.log(`Preview:      ${data.emailPreview}`);
        console.log(`Discount:     ${data.discountCodeId ?? chalk.dim("(none)")}`);
      }
    } catch (err) { handleError(err, g.json); }
  });

config
  .command("set")
  .description("Update config fields (only flags you pass are changed)")
  .option("--enable", "Enable reminders")
  .option("--disable", "Disable reminders")
  .option("--delay-hours <n>", "Hours after last activity before a reminder is sent", (v) => parseInt(v, 10))
  .option("--subject <text>", "Email subject")
  .option("--preview <text>", "Email preview text")
  .option("--discount-code <code>", "Attach a discount code (friendly code string, not id)")
  .option("--no-discount-code", "Clear the attached discount code")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.enable) body.enabled = true;
      if (opts.disable) body.enabled = false;
      if (opts.delayHours !== undefined) body.delayHours = opts.delayHours;
      if (opts.subject !== undefined) body.emailSubject = opts.subject;
      if (opts.preview !== undefined) body.emailPreview = opts.preview;
      if (opts.discountCode === false) {
        // Commander sets option to `false` when --no-discount-code is passed.
        body.discountCodeId = null;
      } else if (typeof opts.discountCode === "string") {
        // Resolve friendly code → id via the existing list endpoint.
        const norm = opts.discountCode.trim().toUpperCase();
        const search = await apiRequest<Array<{ id: string; code: string }>>("/discount-codes", {
          query: { limit: 100 },
          sandbox: g.sandbox,
        });
        const codes = (search as unknown as { data?: Array<{ id: string; code: string }> }).data ?? [];
        const match = codes.find((c) => c.code.toUpperCase() === norm);
        if (!match) {
          console.error(chalk.red(`Discount code not found: ${opts.discountCode}`));
          process.exit(1);
        }
        body.discountCodeId = match.id;
      }

      if (Object.keys(body).length === 0) {
        console.error(chalk.yellow("No changes supplied."));
        process.exit(1);
      }

      const result = await apiRequest<Config>("/account/abandoned-cart", {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) output(result, { json: true });
      else console.log(chalk.green("Config saved."));
    } catch (err) { handleError(err, g.json); }
  });

abandonedCart.addCommand(config);

abandonedCart
  .command("list")
  .description("Recent reminders (newest first)")
  .option("--limit <n>", "How many to show (max 200)", (v) => parseInt(v, 10), 20)
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Reminder[]>("/account/abandoned-cart/reminders", {
        query: { limit: String(opts.limit) },
        sandbox: g.sandbox,
      });
      const list = (result as unknown as { data?: Reminder[] }).data ?? [];
      if (g.json) output(result, { json: true });
      else if (list.length === 0) console.log(chalk.dim("No reminders yet."));
      else {
        console.log(chalk.bold("sent          email                               items  value       status"));
        for (const r of list) {
          const sent = new Date(r.sentAt).toISOString().slice(0, 16).replace("T", " ");
          const value = new Intl.NumberFormat(r.currencyAtSend === "USD" ? "en-US" : "id-ID", {
            style: "currency", currency: r.currencyAtSend, minimumFractionDigits: 0,
          }).format(r.valueAtSend);
          const status = r.recoveredAt ? chalk.green("recovered") : chalk.dim("pending");
          console.log(`${sent}  ${r.email.padEnd(34).slice(0, 34)}  ${String(r.cartSnapshot?.length ?? 0).padStart(5)}  ${value.padStart(10)}  ${status}`);
        }
      }
    } catch (err) { handleError(err, g.json); }
  });

abandonedCart
  .command("stats")
  .description("Recovery stats over a window (7d / 30d / 90d / 365d)")
  .option("--window <window>", "Window: 7d | 30d | 90d | 365d", "30d")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    const days = parseInt(String(opts.window).replace("d", ""), 10) || 30;
    try {
      const result = await apiRequest<Stats>("/account/abandoned-cart/stats", {
        query: { windowDays: String(days) },
        sandbox: g.sandbox,
      });
      const stats = (result as unknown as { data?: Stats }).data ?? (result as unknown as Stats);
      if (g.json) output(result, { json: true });
      else {
        console.log(chalk.dim(`Window: last ${days} days`));
        console.log(`Reminders sent:     ${chalk.bold(stats.remindersSent)}`);
        console.log(`Carts recovered:    ${chalk.bold(stats.cartsRecovered)}`);
        console.log(`Recovery rate:      ${chalk.bold((stats.recoveryRate * 100).toFixed(1))}%`);
        console.log(`Recovered revenue:  ${stats.currency ? new Intl.NumberFormat("id-ID", { style: "currency", currency: stats.currency, minimumFractionDigits: 0 }).format(stats.recoveredRevenue) : chalk.dim("—")}`);
      }
    } catch (err) { handleError(err, g.json); }
  });

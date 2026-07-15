import { Command } from "commander";
import chalk from "chalk";
import { apiRequest, ApiClientError } from "../lib/api.js";
import { output, type Column } from "../lib/output.js";

/**
 * `sell ledger` — per-merchant running money log. Fronts /ledger/*:
 * entries list/get, account balance, per-customer balance, manual
 * adjustments.
 */

function getExitCode(err: unknown): number {
  if (err instanceof ApiClientError) {
    if (err.status === 401 || err.status === 403) return 2;
    if (err.status === 429) return 3;
    if (err.code === "QUOTA_EXCEEDED") return 4;
  }
  return 1;
}

function handleError(err: unknown, json?: boolean): never {
  if (json && err instanceof ApiClientError) {
    console.error(JSON.stringify({ data: null, error: { code: err.code, message: err.message } }, null, 2));
  } else {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
  }
  process.exit(getExitCode(err));
}

// ─── Entries ─────────────────────────────────────────────────

const entries = new Command("entries").description("List / inspect ledger entries");

entries
  .command("list")
  .description("List ledger entries (most recent first)")
  .option("--type <type>", "Filter: credit | debit")
  .option(
    "--category <category>",
    "Filter: sale | refund | platform_fee | channel_fee | shipping_cost | shipping_refund | payout | adjustment"
  )
  .option("--customer <id>", "Filter by customer ID")
  .option("--source-type <type>", "Filter by source (checkout_session, shipment, subscription, etc.)")
  .option("--source-id <id>", "Filter by source record ID")
  .option("--from <iso>", "Filter: entries on/after this datetime (ISO-8601)")
  .option("--to <iso>", "Filter: entries on/before this datetime (ISO-8601)")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--limit <n>", "Items per page (max 100)", parseInt)
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/ledger/entries", {
        query: {
          type: opts.type,
          category: opts.category,
          customerId: opts.customer,
          sourceType: opts.sourceType,
          sourceId: opts.sourceId,
          from: opts.from,
          to: opts.to,
          cursor: opts.cursor,
          limit: opts.limit,
        },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "createdAt", header: "When", width: 20 },
          { key: "category", header: "Category", width: 16 },
          { key: "type", header: "Dir", width: 6 },
          { key: "amount", header: "Amount" },
          { key: "currency", header: "Ccy" },
          { key: "balanceAfter", header: "Balance" },
          { key: "description", header: "Description", width: 36 },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

entries
  .command("get <id>")
  .description("Get a single ledger entry by ID")
  .action(async (id: string, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/ledger/entries/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Balance ─────────────────────────────────────────────────

const balance = new Command("balance").description("Running balance (account-wide or per customer)");

balance
  .command("account")
  .description("Current running balance for the merchant account")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/ledger/balance", {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

balance
  .command("customer <customerId>")
  .description("Running AR balance for a specific customer")
  .action(async (customerId: string, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(
        `/ledger/balance/customers/${customerId}`,
        { sandbox: g.sandbox },
      );
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Adjustments ─────────────────────────────────────────────

const adjustments = new Command("adjustments").description("Manual ledger adjustments (credits, debits, write-offs)");

adjustments
  .command("create")
  .description("Post a manual adjustment entry")
  .requiredOption("--type <type>", "credit (incoming) or debit (outgoing)")
  .requiredOption("--amount <n>", "Positive amount in smallest currency unit", parseInt)
  .requiredOption("--currency <code>", "Currency code (IDR, USD)")
  .requiredOption("--description <text>", "Free-text reason (audit trail)")
  .option("--customer <id>", "Associate with a customer (AR)")
  .option("--transaction-id <key>", "Custom idempotency key (auto-generated if omitted)")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {
        type: opts.type,
        amount: opts.amount,
        currency: opts.currency,
        description: opts.description,
      };
      if (opts.customer) body["customerId"] = opts.customer;
      if (opts.transactionId) body["transactionId"] = opts.transactionId;

      const result = await apiRequest<Record<string, unknown>>("/ledger/adjustments", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const data = (result["data"] ?? result) as Record<string, unknown>;
        const sign = opts.type === "credit" ? "+" : "-";
        console.log(chalk.green(`Posted: ${sign}${opts.amount} ${opts.currency} — ${opts.description}`));
        if (data["id"]) console.log(chalk.dim(`ID: ${String(data["id"])}`));
        if (data["balanceAfter"] !== undefined) console.log(chalk.dim(`Balance: ${data["balanceAfter"]} ${opts.currency}`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Top-level ───────────────────────────────────────────────

const ledger = new Command("ledger").description("Per-merchant ledger — sales, refunds, fees, payouts, adjustments");

ledger.addCommand(entries);
ledger.addCommand(balance);
ledger.addCommand(adjustments);

export { ledger };

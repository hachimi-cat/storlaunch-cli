import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { apiRequest, apiUrl, ApiClientError } from "../lib/api.js";
import { resolveApiKey } from "../lib/config.js";
import { output } from "../lib/output.js";

/**
 * `sell reports` — P&L, cash flow, and CSV ledger export. Reads from the
 * Phase B ledger; no writes.
 */

function getExitCode(err: unknown): number {
  if (err instanceof ApiClientError) {
    if (err.status === 401 || err.status === 403) return 2;
    if (err.status === 429) return 3;
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

const reports = new Command("reports").description("Financial reports — P&L, cash flow, CSV export");

reports
  .command("pnl")
  .description("Profit & loss for a period")
  .requiredOption("--from <iso>", "Period start (ISO-8601)")
  .requiredOption("--to <iso>", "Period end (ISO-8601)")
  .option("--currency <code>", "Filter by currency (e.g. IDR, USD)")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/reports/pnl", {
        query: { from: opts.from, to: opts.to, currency: opts.currency },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const d = (result["data"] ?? result) as Record<string, unknown>;
        const rev = d["revenue"] as Record<string, number>;
        const exp = d["expenses"] as Record<string, number>;
        console.log(chalk.bold(`P&L  ${opts.from}  →  ${opts.to}`));
        console.log(chalk.dim(`Currency: ${d["currency"] ?? "—"}  ·  ${d["entryCount"] ?? 0} entries`));
        console.log();
        console.log(chalk.bold("Revenue"));
        console.log(`  Sales        ${String(rev.sales).padStart(14)}`);
        console.log(`  Refunds    − ${String(rev.refunds).padStart(14)}`);
        console.log(`  Net revenue  ${chalk.bold(String(rev.net).padStart(14))}`);
        console.log();
        console.log(chalk.bold("Expenses"));
        console.log(`  Platform fees      ${String(exp.platformFees).padStart(14)}`);
        console.log(`  Channel fees       ${String(exp.channelFees).padStart(14)}`);
        console.log(`  Shipping costs     ${String(exp.shippingCosts).padStart(14)}`);
        if (exp.shippingRefunds > 0) {
          console.log(`  Shipping refunds − ${String(exp.shippingRefunds).padStart(14)}`);
        }
        console.log(`  Total expenses     ${chalk.bold(String(exp.total).padStart(14))}`);
        console.log();
        const netProfit = Number(d["netProfit"]);
        const profitColor = netProfit >= 0 ? chalk.green : chalk.red;
        console.log(chalk.bold(`Net profit:  ${profitColor(String(netProfit))}`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

reports
  .command("cash-flow")
  .description("Cash flow (opening + closing balance, category breakdown)")
  .requiredOption("--from <iso>", "Period start (ISO-8601)")
  .requiredOption("--to <iso>", "Period end (ISO-8601)")
  .option("--currency <code>", "Filter by currency")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/reports/cash-flow", {
        query: { from: opts.from, to: opts.to, currency: opts.currency },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const d = (result["data"] ?? result) as Record<string, unknown>;
        const inflows = d["inflows"] as Record<string, number>;
        const outflows = d["outflows"] as Record<string, number>;
        console.log(chalk.bold(`Cash Flow  ${opts.from}  →  ${opts.to}`));
        console.log(chalk.dim(`Currency: ${d["currency"] ?? "—"}  ·  ${d["entryCount"] ?? 0} entries`));
        console.log();
        console.log(`Opening balance   ${String(d["openingBalance"]).padStart(14)}`);
        console.log(`Net change        ${chalk.bold(String(d["netChange"]).padStart(14))}`);
        console.log(`Closing balance   ${String(d["closingBalance"]).padStart(14)}`);
        console.log();
        console.log(chalk.green.bold(`Inflows  (total: ${d["totalIn"]})`));
        for (const [k, v] of Object.entries(inflows)) console.log(`  ${k.padEnd(20)} ${String(v).padStart(12)}`);
        console.log();
        console.log(chalk.red.bold(`Outflows (total: ${d["totalOut"]})`));
        for (const [k, v] of Object.entries(outflows)) console.log(`  ${k.padEnd(20)} ${String(v).padStart(12)}`);
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

reports
  .command("export-ledger")
  .description("Download ledger entries as CSV for a period")
  .requiredOption("--from <iso>", "Period start (ISO-8601)")
  .requiredOption("--to <iso>", "Period end (ISO-8601)")
  .option("--currency <code>", "Filter by currency")
  .option("--out <path>", "Write CSV to this path (default: stdout)")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const token = resolveApiKey({ sandbox: g.sandbox });
      if (!token) {
        throw new ApiClientError({
          status: 401,
          message: "Not authenticated. Run `storlaunch sell auth login --key <api-key>` first.",
          code: "AUTH_REQUIRED",
        });
      }
      const url = apiUrl("/reports/ledger.csv");
      url.searchParams.set("from", opts.from);
      url.searchParams.set("to", opts.to);
      if (opts.currency) url.searchParams.set("currency", opts.currency);

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" },
      });
      if (!response.ok) {
        let errorBody: { message?: string; code?: string } = {};
        try { errorBody = (await response.json()) as { message?: string; code?: string }; } catch { /* ignore */ }
        throw new ApiClientError({
          status: response.status,
          message: errorBody.message ?? `CSV download failed with status ${response.status}`,
          code: errorBody.code,
        });
      }
      const csv = await response.text();
      if (opts.out) {
        writeFileSync(opts.out, csv, "utf8");
        if (!g.json) console.log(chalk.green(`CSV written to ${opts.out} (${csv.length} bytes)`));
      } else {
        process.stdout.write(csv);
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

export { reports };

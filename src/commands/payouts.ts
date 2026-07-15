import { Command } from "commander";
import chalk from "chalk";
import { apiRequest, ApiClientError } from "../lib/api.js";
import { output, type Column } from "../lib/output.js";

/**
 * `sell payouts` — withdraw funds to the merchant bank. Manual mode for
 * now (platform operator wires money + marks paid). Commands mirror the
 * REST routes at /api/v1/payouts/*.
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

// ─── Bank account ────────────────────────────────────────────

const bankAccount = new Command("bank-account").description("Default payout bank account");

bankAccount
  .command("get")
  .description("Show the current default bank account")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payouts/bank-account", {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

bankAccount
  .command("set")
  .description("Set the default bank account")
  .requiredOption("--name <name>", "Bank name (e.g. 'Bank Central Asia')")
  .requiredOption("--number <number>", "Bank account number")
  .requiredOption("--holder <name>", "Account holder name (as on passbook)")
  .option("--code <code>", "Bank code (e.g. BCA, MANDIRI, BNI)")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payouts/bank-account", {
        method: "PATCH",
        body: {
          bankName: opts.name,
          bankAccountNumber: opts.number,
          bankAccountHolder: opts.holder,
          bankCode: opts.code ?? null,
        },
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Bank account saved: ${opts.name} · ${opts.number} · ${opts.holder}`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Payouts ─────────────────────────────────────────────────

const payouts = new Command("payouts").description("Manage merchant payouts");

payouts.addCommand(bankAccount);

payouts
  .command("balance")
  .description("Show available payout balance (ledger − in-flight)")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payouts/balance", {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

payouts
  .command("list")
  .description("List payouts")
  .option("--status <status>", "Filter: pending | in_transit | paid | failed | cancelled")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payouts", {
        query: { status: opts.status, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 24 },
          { key: "requestedAt", header: "Requested", width: 20 },
          { key: "amount", header: "Amount" },
          { key: "currency", header: "Ccy" },
          { key: "status", header: "Status", width: 12 },
          { key: "bankName", header: "Bank", width: 16 },
          { key: "reference", header: "Ref", width: 16 },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

payouts
  .command("get <id>")
  .description("Get a single payout")
  .action(async (id: string, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payouts/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

payouts
  .command("create")
  .description("Request a new payout (uses default bank unless override passed)")
  .requiredOption("--amount <n>", "Amount in smallest currency unit", parseInt)
  .requiredOption("--currency <code>", "Currency code (IDR, USD)")
  .option("--note <text>", "Free-text note on the payout")
  .option("--bank-name <name>", "Override default bank name for this payout")
  .option("--bank-number <number>", "Override default bank account number")
  .option("--bank-holder <name>", "Override default account holder")
  .option("--bank-code <code>", "Override default bank code")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {
        amount: opts.amount,
        currency: opts.currency,
      };
      if (opts.note) body["note"] = opts.note;
      if (opts.bankName) body["bankName"] = opts.bankName;
      if (opts.bankNumber) body["bankAccountNumber"] = opts.bankNumber;
      if (opts.bankHolder) body["bankAccountHolder"] = opts.bankHolder;
      if (opts.bankCode) body["bankCode"] = opts.bankCode;

      const result = await apiRequest<Record<string, unknown>>("/payouts", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const d = (result["data"] ?? result) as Record<string, unknown>;
        console.log(chalk.green(`Payout requested: ${String(d["id"])} (status: ${d["status"]})`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

payouts
  .command("cancel <id>")
  .description("Cancel a pending payout (fails if already processing)")
  .action(async (id: string, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payouts/${id}/cancel`, {
        method: "POST",
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Payout ${id} cancelled.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

export { payouts };

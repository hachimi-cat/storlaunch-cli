import { Command } from "commander";
import chalk from "chalk";
import { apiRequest, ApiClientError } from "../lib/api.js";
import { output, type Column } from "../lib/output.js";

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

const domains = new Command("domains").description("Manage custom domains");

domains
  .command("list")
  .description("List custom domains")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/account/domains", {
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "domain", header: "Domain", width: 32 },
          { key: "status", header: "Status" },
          { key: "verifiedAt", header: "Verified" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

domains
  .command("add <domain>")
  .description("Add a custom domain")
  .action(async (domain: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/account/domains", {
        method: "POST",
        body: { domain },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(`Domain added: ${chalk.bold(String(result["domain"] ?? domain))}`);
        if (result["id"]) console.log(`ID: ${result["id"]}`);
        if (result["status"]) console.log(`Status: ${result["status"]}`);
        if (result["dnsRecords"]) {
          console.log(chalk.dim("\nDNS records to add at your registrar:"));
          console.log(JSON.stringify(result["dnsRecords"], null, 2));
        }
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

domains
  .command("verify <id>")
  .description("Trigger verification for a domain")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/account/domains/${id}/verify`, {
        method: "POST",
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result ?? { verified: true, id }, { json: true });
      } else {
        console.log(chalk.green(`Domain ${id} verification triggered.`));
        if (result?.["status"]) console.log(`Status: ${result["status"]}`);
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

domains
  .command("remove <id>")
  .description("Remove a custom domain")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/account/domains/${id}`, { method: "DELETE", sandbox: g.sandbox });
      if (g.json) {
        output({ deleted: true, id }, { json: true });
      } else {
        console.log(chalk.green(`Domain ${id} removed.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

export { domains };

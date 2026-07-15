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

const apiKeys = new Command("api-keys").description("Manage account API keys");

apiKeys
  .command("list")
  .description("List API keys")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/account/api-keys", {
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 24 },
          { key: "prefix", header: "Prefix", width: 16 },
          { key: "name", header: "Name", width: 24 },
          { key: "createdAt", header: "Created" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

apiKeys
  .command("create <name>")
  .description("Create a new API key (the secret is shown only once)")
  .action(async (name: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/account/api-keys", {
        method: "POST",
        body: { description: name },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(`API key created: ${chalk.bold(String(result["id"]))}`);
        if (result["secret"]) {
          console.log(`Secret: ${chalk.yellow(String(result["secret"]))}   ${chalk.dim("<- Save this! Not shown again.")}`);
        }
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

apiKeys
  .command("revoke <id>")
  .description("Revoke an API key")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/account/api-keys/${id}/revoke`, {
        method: "POST",
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result ?? { revoked: true, id }, { json: true });
      } else {
        console.log(chalk.green(`API key ${id} revoked.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

export { apiKeys };

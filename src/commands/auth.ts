import { Command } from "commander";
import chalk from "chalk";
import { setConfig, clearConfig, getConfig, getConfigPath } from "../lib/config.js";
import { apiRequest, ApiClientError } from "../lib/api.js";
import { output } from "../lib/output.js";

function getExitCode(err: unknown): number {
  if (err instanceof ApiClientError) {
    if (err.status === 401 || err.status === 403) return 2;
    if (err.status === 429) return 3;
  }
  return 1;
}

const auth = new Command("auth").description("Manage authentication");

auth
  .command("login")
  .description("Authenticate the CLI with an API key")
  .requiredOption("--key <api-key>", "API key (sk_live_* or sk_test_*)")
  .action(async (opts: { key: string }) => {
    const key = opts.key;

    if (key.startsWith("sk_test_")) {
      setConfig({ testApiKey: key });
      console.log(chalk.green("Sandbox API key saved."));
    } else if (key.startsWith("sk_live_")) {
      setConfig({ token: key });
      console.log(chalk.green("Production API key saved."));
    } else {
      console.error(chalk.red("Error: API key must start with sk_live_ or sk_test_"));
      process.exit(1);
    }

    console.log(chalk.dim(`Config: ${getConfigPath()}`));
  });

auth
  .command("logout")
  .description("Remove stored credentials")
  .action(() => {
    clearConfig();
    console.log(chalk.green("Logged out. Credentials removed."));
  });

auth
  .command("whoami")
  .description("Show current account info")
  .action(async (_, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const account = await apiRequest<Record<string, unknown>>("/account", {
        sandbox: globalOpts.sandbox,
      });

      if (globalOpts.json) {
        output(account, { json: true });
      } else {
        const config = getConfig();
        const env = globalOpts.sandbox ? "sandbox" : "production";
        output({
          Account: account["name"] ?? account["companyName"] ?? "-",
          Email: account["email"] ?? "-",
          Plan: account["plan"] ?? "-",
          Slug: account["slug"] ?? "-",
          Env: env,
        });
      }
    } catch (err) {
      if (globalOpts.json && err instanceof ApiClientError) {
        console.error(JSON.stringify({ data: null, error: { code: err.code, message: err.message } }, null, 2));
      } else {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      }
      process.exit(getExitCode(err));
    }
  });

export { auth };

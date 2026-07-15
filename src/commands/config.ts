import { Command } from "commander";
import chalk from "chalk";
import { getConfig, setConfig } from "../lib/config.js";
import { output } from "../lib/output.js";

const config = new Command("config").description("Manage local CLI configuration");

config
  .command("set <key> <value>")
  .description("Set a config value")
  .action((key: string, value: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean }>();
    const current = (getConfig() ?? { api_url: "", token: "" }) as unknown as Record<string, unknown>;

    // Support dotted keys like defaults.currency
    if (key.startsWith("defaults.")) {
      const subKey = key.slice("defaults.".length);
      const defaults = (current["defaults"] ?? {}) as Record<string, unknown>;
      defaults[subKey] = value;
      setConfig({ ...current, defaults } as Partial<import("../lib/config.js").StorlaunchConfig>);
    } else {
      setConfig({ [key]: value } as Partial<import("../lib/config.js").StorlaunchConfig>);
    }

    if (g.json) {
      output({ key, value }, { json: true });
    } else {
      console.log(chalk.green(`${key} = ${value}`));
    }
  });

config
  .command("get <key>")
  .description("Get a config value")
  .action((key: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean }>();
    const current = getConfig();

    if (!current) {
      console.error(chalk.red("No config found. Run `storlaunch auth login` first."));
      process.exit(1);
    }

    const configObj = current as unknown as Record<string, unknown>;
    let value: unknown;
    if (key.startsWith("defaults.")) {
      const subKey = key.slice("defaults.".length);
      const defaults = (configObj["defaults"] ?? {}) as Record<string, unknown>;
      value = defaults[subKey];
    } else {
      value = configObj[key];
    }

    if (value === undefined) {
      console.error(chalk.red(`Config key "${key}" not found.`));
      process.exit(1);
    }

    if (g.json) {
      output({ key, value }, { json: true });
    } else {
      console.log(String(value));
    }
  });

config
  .command("list")
  .description("Print all config values")
  .action((_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean }>();
    const current = getConfig();

    if (!current) {
      console.error(chalk.red("No config found. Run `storlaunch auth login` first."));
      process.exit(1);
    }

    if (g.json) {
      output(current, { json: true });
    } else {
      // Mask sensitive keys
      const display = { ...(current as unknown as Record<string, unknown>) };
      if (display["token"] && typeof display["token"] === "string") {
        display["token"] = (display["token"] as string).slice(0, 12) + "..." + (display["token"] as string).slice(-4);
      }
      if (display["testApiKey"] && typeof display["testApiKey"] === "string") {
        display["testApiKey"] = (display["testApiKey"] as string).slice(0, 12) + "..." + (display["testApiKey"] as string).slice(-4);
      }
      output(display);
    }
  });

export { config };

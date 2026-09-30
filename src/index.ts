import { Command } from "commander";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string; description: string };

const program = new Command();

program
  .name("storlaunch")
  .version(pkg.version)
  .description(pkg.description)
  .option("--json", "Output in JSON format")
  .option("--sandbox", "Use sandbox/test API key");

// ─── Register command groups ─────────────────────────────────

import { sell } from "./commands/sell.js";
import { buy } from "./commands/buy.js";
import { buildApiCommand } from "./commands/api.generated.js";

program.addCommand(sell);
program.addCommand(buy);
// Every route of the API, one command each (generated from the API spec: scripts/apigen.sh)
program.addCommand(buildApiCommand());

// ─── Parse ───────────────────────────────────────────────────

program.parse();

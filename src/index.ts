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

program.addCommand(sell);
program.addCommand(buy);

// ─── Parse ───────────────────────────────────────────────────

program.parse();

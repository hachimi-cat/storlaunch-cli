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

const auditLog = new Command("audit-log").description("View account audit-log events");

auditLog
  .command("list")
  .description("List audit-log entries")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--since <date>", "ISO 8601 date — only entries on/after this timestamp")
  .option("--event-type <type>", "Filter by event type")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/account/audit-log", {
        query: {
          limit: opts.limit,
          since: opts.since,
          eventType: opts.eventType,
        },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "eventType", header: "Event", width: 28 },
          { key: "actor", header: "Actor", width: 20 },
          { key: "createdAt", header: "When" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

export { auditLog };

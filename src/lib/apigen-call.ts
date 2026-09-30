/**
 * How the generated `storlaunch api <area> <action>` commands (commands/api.generated.ts)
 * make their call: this CLI's own credentials and client (apiRequest: the stored or
 * STORLAUNCH_API_KEY key as `Authorization: Bearer`, --sandbox for the test key), its own
 * output and errors.
 */
import type { Command } from "commander";
import chalk from "chalk";
import { apiRequest, ApiClientError } from "./api.js";
import { output } from "./output.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Globals = { json?: boolean; sandbox?: boolean };

function globals(cmd: Command): Globals {
  return cmd.optsWithGlobals<Globals>();
}

export async function callRoute(
  cmd: Command,
  method: string,
  path: string,
  query: Record<string, unknown>,
  body: Record<string, unknown> | undefined,
): Promise<void> {
  const g = globals(cmd);
  try {
    // `path` is absolute (/api/v1/…), so it resolves against the configured API URL's host.
    const result = await apiRequest<unknown>(path, {
      method: method as Method,
      query: Object.fromEntries(
        Object.entries(query).map(([k, v]): [string, string] => [k, typeof v === "string" ? v : JSON.stringify(v)]),
      ),
      body,
      sandbox: g.sandbox,
    });
    output(result ?? { ok: true }, { json: true });
    process.exit(0);
  } catch (err) {
    fail(err, g);
  }
}

/** Bad input to a generated command (a missing field, a value the spec does not allow). */
export async function failRoute(cmd: Command, err: unknown): Promise<never> {
  fail(err, globals(cmd));
}

// The same exit codes and error output as the hand-written commands.
function fail(err: unknown, g: Globals): never {
  if (g.json && err instanceof ApiClientError) {
    console.error(JSON.stringify({ data: null, error: { code: err.code, message: err.message } }, null, 2));
  } else {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
  }
  const code = err instanceof ApiClientError ? (err.status === 401 || err.status === 403 ? 2 : err.status === 429 ? 3 : 1) : 1;
  process.exit(code);
}

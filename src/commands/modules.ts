import { Command } from "commander";
import chalk from "chalk";
import { apiRequest, ApiClientError } from "../lib/api.js";
import { output, type Column } from "../lib/output.js";

/**
 * `sell modules` — enable/disable feature modules (payment, fulfillment,
 * marketing). Backend at backend/src/routes/modules.ts exposes only two
 * endpoints (GET / POST /modules); the audit asked for
 *   POST /modules/<name>/enable
 *   POST /modules/<name>/disable
 *   GET  /modules/<name>
 * but those don't exist. We expose the same UX by mapping:
 *   enable <name>  → POST /modules  { module, enabled: true  }
 *   disable <name> → POST /modules  { module, enabled: false }
 *   status <name>  → GET  /modules  + client-side pick
 */

function getExitCode(err: unknown): number {
  if (err instanceof ApiClientError) {
    if (err.status === 401 || err.status === 403) return 2;
    if (err.status === 429) return 3;
    if (err.code === "QUOTA_EXCEEDED" || err.code === "plan_upgrade_required") return 4;
  }
  return 1;
}

function handleError(err: unknown, json?: boolean): never {
  if (json && err instanceof ApiClientError) {
    console.error(
      JSON.stringify({ data: null, error: { code: err.code, message: err.message } }, null, 2)
    );
  } else {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
  }
  process.exit(getExitCode(err));
}

function unwrap<T = unknown>(result: unknown): T {
  if (result && typeof result === "object" && "data" in (result as Record<string, unknown>)) {
    return (result as { data: T }).data;
  }
  return result as T;
}

interface ModulesPayload {
  modules?: Record<string, { enabled?: boolean; [k: string]: unknown }>;
  allowed?: string[];
  plan?: string;
  [k: string]: unknown;
}

const modules = new Command("modules").description(
  "Enable/disable feature modules (payment, fulfillment, marketing)"
);

modules
  .command("list")
  .description("List modules with enabled state + tier-allowed flag")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/modules", {
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
        return;
      }
      const payload = unwrap<ModulesPayload>(result) ?? {};
      const allowed = new Set(payload.allowed ?? []);
      const map = payload.modules ?? {};
      const rows = Object.entries(map).map(([name, value]) => ({
        module: name,
        enabled: Boolean((value as { enabled?: boolean })?.enabled),
        allowedForTier: allowed.has(name),
      }));
      const cols: Column[] = [
        { key: "module", header: "Module", width: 16 },
        { key: "enabled", header: "Enabled", width: 10 },
        { key: "allowedForTier", header: "Allowed (plan)" },
      ];
      if (payload.plan) console.log(chalk.dim(`Plan: ${payload.plan}`));
      output(rows, { columns: cols });
    } catch (err) {
      handleError(err, g.json);
    }
  });

async function toggle(name: string, enabled: boolean, sandbox: boolean | undefined, json: boolean | undefined) {
  const result = await apiRequest<Record<string, unknown>>("/modules", {
    method: "POST",
    body: { module: name, enabled },
    sandbox,
  });
  if (json) {
    output(result, { json: true });
  } else {
    const verb = enabled ? "enabled" : "disabled";
    console.log(chalk.green(`Module "${name}" ${verb}.`));
    const data = unwrap<Record<string, unknown>>(result);
    if (data) output(data, {});
  }
}

modules
  .command("enable <name>")
  .description("Enable a module (payment | fulfillment | marketing)")
  .action(async (name: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await toggle(name, true, g.sandbox, g.json);
    } catch (err) {
      handleError(err, g.json);
    }
  });

modules
  .command("disable <name>")
  .description("Disable a module")
  .action(async (name: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await toggle(name, false, g.sandbox, g.json);
    } catch (err) {
      handleError(err, g.json);
    }
  });

modules
  .command("status <name>")
  .description("Show enabled state + tier permission for one module")
  .action(async (name: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/modules", {
        sandbox: g.sandbox,
      });
      const payload = unwrap<ModulesPayload>(result) ?? {};
      const entry = payload.modules?.[name] ?? null;
      const status = {
        module: name,
        enabled: Boolean((entry as { enabled?: boolean } | null)?.enabled),
        allowedForTier: (payload.allowed ?? []).includes(name),
        plan: payload.plan,
        details: entry,
      };
      if (g.json) {
        output({ data: status }, { json: true });
      } else if (!entry) {
        console.log(chalk.dim(`Module "${name}" not found in modules state.`));
      } else {
        output(status as unknown as Record<string, unknown>, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

export { modules };

import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { apiRequest, ApiClientError } from "../lib/api.js";
import { output, type Column } from "../lib/output.js";

/**
 * `sell settings` — merchant business profile, payment provider adapters,
 * and checkout/receipt/invoice templates. All three groups proxy through
 * Storlaunch's `/payment/plugipay-settings/*` mount to Plugipay (see
 * backend/src/routes/payment/plugipay-settings-proxy.ts).
 *
 * Real endpoints (after Plugipay rewrite):
 *   business    → GET/PATCH /checkout/settings
 *   providers   → GET /adapters (list all); PUT /adapters/<kind> to upsert
 *   templates   → CRUD under /templates, plus /:id/make-default and /:id/duplicate
 *
 * The audit hinted at `/settings/business`, `/settings/providers`, and
 * `/settings/templates` paths — those don't exist. Storlaunch does not
 * mount any router at `/settings`; everything lives under the Plugipay
 * proxy. Routes that don't exist (none here — all three groups verified)
 * are noted in the parent commit message.
 */

const PREFIX = "/payment/plugipay-settings";
const PROVIDER_KINDS = ["xendit", "paypal", "midtrans", "manual", "managed"] as const;
type ProviderKind = (typeof PROVIDER_KINDS)[number];

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
    console.error(
      JSON.stringify({ data: null, error: { code: err.code, message: err.message } }, null, 2)
    );
  } else {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
  }
  process.exit(getExitCode(err));
}

function parseBody(raw: string | undefined, fileRaw: string | undefined): Record<string, unknown> {
  let source: string | undefined;
  if (fileRaw) {
    try {
      source = readFileSync(fileRaw, "utf-8");
    } catch (e) {
      console.error(chalk.red(`Error: cannot read --body-file ${fileRaw}: ${(e as Error).message}`));
      process.exit(1);
    }
  } else if (raw) {
    source = raw;
  } else {
    console.error(chalk.red("Error: --body <json> or --body-file <path> is required"));
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(chalk.red("Error: body must be a JSON object"));
      process.exit(1);
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    console.error(chalk.red(`Error: --body is not valid JSON: ${(e as Error).message}`));
    process.exit(1);
  }
}

function unwrap<T = unknown>(result: unknown): T {
  if (result && typeof result === "object" && "data" in (result as Record<string, unknown>)) {
    return (result as { data: T }).data;
  }
  return result as T;
}

const settings = new Command("settings").description(
  "Merchant business profile, payment providers, and templates (proxied via Plugipay)"
);

// ─── business ───────────────────────────────────────────────────────────────

const business = new Command("business").description(
  "Business profile + brand + receipt template (Plugipay checkout settings)"
);

business
  .command("get")
  .description("Show current business profile + branding + payment methods")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`${PREFIX}/checkout/settings`, {
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        const data = unwrap<Record<string, unknown>>(result);
        output(data, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

business
  .command("update")
  .description("Patch business profile fields (brandName, businessEmail, etc.)")
  .option("--body <json>", "JSON object with fields to update")
  .option("--body-file <path>", "Read JSON body from a file")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    const body = parseBody(opts.body, opts.bodyFile);
    try {
      const result = await apiRequest<Record<string, unknown>>(`${PREFIX}/checkout/settings`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green("Business profile updated."));
        const data = unwrap<Record<string, unknown>>(result);
        output(data, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

settings.addCommand(business);

// ─── providers ──────────────────────────────────────────────────────────────

const providers = new Command("providers").description(
  "Payment provider adapters (xendit, paypal, midtrans, manual, managed)"
);

providers
  .command("list")
  .description("List configured provider adapters")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`${PREFIX}/adapters`, {
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        const map = unwrap<Record<string, Record<string, unknown> | null>>(result) ?? {};
        const rows = Object.entries(map)
          .filter(([, v]) => v != null)
          .map(([kind, v]) => ({ kind, ...(v as Record<string, unknown>) }));
        const cols: Column[] = [
          { key: "kind", header: "Provider", width: 12 },
          { key: "status", header: "Status", width: 14 },
          { key: "secretKeyLast4", header: "Key…", width: 8 },
          { key: "configuredAt", header: "Configured" },
        ];
        output(rows, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

providers
  .command("get <kind>")
  .description(`Get one provider adapter — kind: ${PROVIDER_KINDS.join(" | ")}`)
  .action(async (kind: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    if (!(PROVIDER_KINDS as readonly string[]).includes(kind)) {
      console.error(
        chalk.red(`Error: unknown provider "${kind}". Expected one of: ${PROVIDER_KINDS.join(", ")}`)
      );
      process.exit(1);
    }
    try {
      // No GET /adapters/<kind> on the backend — pull the whole map and pick.
      const result = await apiRequest<Record<string, unknown>>(`${PREFIX}/adapters`, {
        sandbox: g.sandbox,
      });
      const map = unwrap<Record<string, unknown>>(result) ?? {};
      const item = map[kind] ?? null;
      if (g.json) {
        output({ data: item }, { json: true });
      } else if (item == null) {
        console.log(chalk.dim(`Provider "${kind}" is not configured.`));
      } else {
        output(item, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

providers
  .command("update <kind>")
  .description(`Upsert provider config (PUT /adapters/<kind>) — kind: ${PROVIDER_KINDS.join(" | ")}`)
  .option("--body <json>", "JSON object with provider config")
  .option("--body-file <path>", "Read JSON body from a file")
  .action(async (kind: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    if (!(PROVIDER_KINDS as readonly string[]).includes(kind)) {
      console.error(
        chalk.red(`Error: unknown provider "${kind}". Expected one of: ${PROVIDER_KINDS.join(", ")}`)
      );
      process.exit(1);
    }
    const body = parseBody(opts.body, opts.bodyFile);
    try {
      const result = await apiRequest<Record<string, unknown>>(
        `${PREFIX}/adapters/${kind}`,
        { method: "PUT", body, sandbox: g.sandbox }
      );
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Provider "${kind}" updated.`));
        const data = unwrap<Record<string, unknown>>(result);
        output(data, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

settings.addCommand(providers);

// ─── templates ──────────────────────────────────────────────────────────────

const templates = new Command("templates").description(
  "Checkout/receipt/invoice templates (Plugipay)"
);

templates
  .command("list")
  .description("List templates")
  .option("--kind <kind>", "Filter by kind: receipt | invoice | checkout")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`${PREFIX}/templates`, {
        query: { kind: opts.kind },
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        const data = unwrap<Record<string, unknown>[]>(result) ?? [];
        const cols: Column[] = [
          { key: "id", header: "ID", width: 22 },
          { key: "kind", header: "Kind", width: 10 },
          { key: "name", header: "Name", width: 28 },
          { key: "isDefault", header: "Default" },
        ];
        output(data, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

templates
  .command("get <id>")
  .description("Show one template (full config)")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`${PREFIX}/templates/${id}`, {
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        const data = unwrap<Record<string, unknown>>(result);
        output(data, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

templates
  .command("create")
  .description("Create a template")
  .option("--body <json>", "JSON object: { kind, name, config, isDefault? }")
  .option("--body-file <path>", "Read JSON body from a file")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    const body = parseBody(opts.body, opts.bodyFile);
    try {
      const result = await apiRequest<Record<string, unknown>>(`${PREFIX}/templates`, {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        const data = unwrap<Record<string, unknown>>(result);
        console.log(chalk.green(`Template created: ${chalk.bold(String(data?.id ?? "?"))}`));
        output(data, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

templates
  .command("update <id>")
  .description("Patch a template")
  .option("--body <json>", "JSON object with fields to update")
  .option("--body-file <path>", "Read JSON body from a file")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    const body = parseBody(opts.body, opts.bodyFile);
    try {
      const result = await apiRequest<Record<string, unknown>>(`${PREFIX}/templates/${id}`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Template ${id} updated.`));
        const data = unwrap<Record<string, unknown>>(result);
        output(data, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

templates
  .command("make-default <id>")
  .description("Mark template as the default for its kind")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(
        `${PREFIX}/templates/${id}/make-default`,
        { method: "POST", sandbox: g.sandbox }
      );
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Template ${id} is now the default.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

templates
  .command("duplicate <id>")
  .description("Duplicate a template")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(
        `${PREFIX}/templates/${id}/duplicate`,
        { method: "POST", sandbox: g.sandbox }
      );
      if (g.json) {
        output(result, { json: true });
      } else {
        const data = unwrap<Record<string, unknown>>(result);
        console.log(chalk.green(`Template duplicated: ${chalk.bold(String(data?.id ?? "?"))}`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

templates
  .command("delete <id>")
  .description("Delete a template")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`${PREFIX}/templates/${id}`, {
        method: "DELETE",
        sandbox: g.sandbox,
      });
      if (g.json) {
        output({ deleted: true, id }, { json: true });
      } else {
        console.log(chalk.green(`Template ${id} deleted.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

settings.addCommand(templates);

export { settings };

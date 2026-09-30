import { Command } from "commander";
import chalk from "chalk";
import { apiRequest, apiUrl, ApiClientError } from "../lib/api.js";
import { output, type Column } from "../lib/output.js";

/**
 * `sell discount-codes` — manage promo codes. Maps to /discount-codes CRUD
 * + the public /storefront/public/validate-discount dry-run endpoint.
 */

function getExitCode(err: unknown): number {
  if (err instanceof ApiClientError) {
    if (err.status === 401 || err.status === 403) return 2;
    if (err.status === 429) return 3;
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

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

const discountCodes = new Command("discount-codes").description("Manage discount codes / vouchers");

discountCodes
  .command("list")
  .description("List discount codes")
  .option("--active", "Only show active codes")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/discount-codes", {
        query: { active: opts.active ? "true" : undefined, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "code", header: "Code", width: 20 },
          { key: "type", header: "Type", width: 18 },
          { key: "value", header: "Value" },
          { key: "currency", header: "Ccy" },
          { key: "scope", header: "Scope", width: 10 },
          { key: "redemptionCount", header: "Used" },
          { key: "active", header: "Active" },
          { key: "expiresAt", header: "Expires", width: 22 },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

discountCodes
  .command("get <id>")
  .description("Get a single discount code")
  .action(async (id: string, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/discount-codes/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

discountCodes
  .command("create")
  .description("Create a discount code")
  .requiredOption("--code <code>", "Code the buyer types (normalized to UPPERCASE)")
  .requiredOption(
    "--type <type>",
    "percent | fixed | shipping_percent | shipping_fixed"
  )
  .requiredOption("--value <n>", "Percent 1-100 OR fixed amount in smallest currency unit", parseInt)
  .requiredOption("--currency <code>", "Currency code (must match cart currency)")
  .option("--description <text>", "Human description / internal note")
  .option("--scope <scope>", "cart | products | tags", "cart")
  .option("--products <ids>", "Comma-separated product IDs (scope=products)")
  .option("--tags <tags>", "Comma-separated product tags (scope=tags)")
  .option("--min-purchase <n>", "Minimum subtotal required", parseInt)
  .option("--max-uses <n>", "Global maximum redemptions", parseInt)
  .option("--max-per-customer <n>", "Per-customer redemption cap", parseInt)
  .option("--starts <iso>", "ISO-8601 datetime (not-yet-active before this)")
  .option("--expires <iso>", "ISO-8601 datetime (expired after this)")
  .option("--inactive", "Create in inactive state")
  .option("--public", "Advertise the code on the merchant's storefront (default: private)")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {
        code: opts.code,
        type: opts.type,
        value: opts.value,
        currency: opts.currency,
      };
      if (opts.description) body["description"] = opts.description;
      if (opts.scope) body["scope"] = opts.scope;
      const products = parseCsv(opts.products);
      if (products) body["productIds"] = products;
      const tags = parseCsv(opts.tags);
      if (tags) body["tagFilter"] = tags;
      if (opts.minPurchase !== undefined) body["minPurchaseAmount"] = opts.minPurchase;
      if (opts.maxUses !== undefined) body["maxUsesTotal"] = opts.maxUses;
      if (opts.maxPerCustomer !== undefined) body["maxUsesPerCustomer"] = opts.maxPerCustomer;
      if (opts.starts) body["startsAt"] = opts.starts;
      if (opts.expires) body["expiresAt"] = opts.expires;
      if (opts.inactive) body["active"] = false;
      if (opts.public) body["public"] = true;

      const result = await apiRequest<Record<string, unknown>>("/discount-codes", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const data = (result["data"] ?? result) as Record<string, unknown>;
        console.log(chalk.green(`Discount code created: ${String(data["code"])}`));
        console.log(chalk.dim(`ID: ${String(data["id"])}`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

discountCodes
  .command("update <id>")
  .description("Update a discount code (code string itself is immutable)")
  .option("--description <text>", "New description")
  .option("--value <n>", "New value", parseInt)
  .option("--min-purchase <n>", "New min purchase", parseInt)
  .option("--max-uses <n>", "New global max", parseInt)
  .option("--max-per-customer <n>", "New per-customer max", parseInt)
  .option("--expires <iso>", "New expiry ISO-8601")
  .option("--active", "Reactivate")
  .option("--inactive", "Deactivate")
  .option("--public", "Show on storefront")
  .option("--private", "Hide from storefront")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.description !== undefined) body["description"] = opts.description;
      if (opts.value !== undefined) body["value"] = opts.value;
      if (opts.minPurchase !== undefined) body["minPurchaseAmount"] = opts.minPurchase;
      if (opts.maxUses !== undefined) body["maxUsesTotal"] = opts.maxUses;
      if (opts.maxPerCustomer !== undefined) body["maxUsesPerCustomer"] = opts.maxPerCustomer;
      if (opts.expires) body["expiresAt"] = opts.expires;
      if (opts.active) body["active"] = true;
      if (opts.inactive) body["active"] = false;
      if (opts.public) body["public"] = true;
      if (opts.private) body["public"] = false;

      const result = await apiRequest<Record<string, unknown>>(`/discount-codes/${id}`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Discount code ${id} updated.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

discountCodes
  .command("delete <id>")
  .description("Soft-archive a discount code (deactivates without deleting history)")
  .action(async (id: string, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/discount-codes/${id}`, { method: "DELETE", sandbox: g.sandbox });
      if (g.json) {
        output({ id, active: false }, { json: true });
      } else {
        console.log(chalk.green(`Discount code ${id} deactivated.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

discountCodes
  .command("validate")
  .description("Dry-run validate a code against a simulated cart (no commit)")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .requiredOption("--code <code>", "Discount code to validate")
  .requiredOption("--subtotal <n>", "Cart subtotal (smallest currency unit)", parseInt)
  .requiredOption("--currency <code>", "Currency")
  .option("--shipping <n>", "Shipping cost", parseInt, 0)
  .option("--items <json>", "JSON array of items [{productId, price, quantity, tags}]")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const url = apiUrl("/storefront/public/validate-discount");
      const body: Record<string, unknown> = {
        merchantSlug: opts.merchant,
        code: opts.code,
        subtotal: opts.subtotal,
        currency: opts.currency,
        shipping: opts.shipping ?? 0,
      };
      if (opts.items) {
        try { body["items"] = JSON.parse(opts.items); }
        catch { console.error(chalk.red("Error: --items must be valid JSON array")); process.exit(1); }
      }
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new ApiClientError({
          status: response.status,
          message: (data as { error?: { message?: string } }).error?.message ?? `Validation failed with status ${response.status}`,
          code: (data as { error?: { code?: string } }).error?.code,
        });
      }
      output(data, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

export { discountCodes };

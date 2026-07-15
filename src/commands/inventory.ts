import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { apiRequest, ApiClientError } from "../lib/api.js";
import { output, type Column } from "../lib/output.js";

/**
 * `sell inventory` — variants, warehouses, stock adjustments, CSV import,
 * low-stock alerts, movement history. Covers the full set of /inventory/*
 * merchant endpoints.
 */

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

// ─── Variants ────────────────────────────────────────────────

const variants = new Command("variants").description("Manage product variants (SKUs)");

variants
  .command("create")
  .description("Create a variant (SKU) for a product")
  .requiredOption("--product <id>", "Product ID")
  .requiredOption("--name <name>", "Variant name (e.g. 'Red / M')")
  .option("--sku <sku>", "SKU code")
  .option("--price-delta <amount>", "Price delta vs product price in smallest currency unit", parseInt)
  .option("--cost-price <amount>", "Cost price for margin tracking", parseInt)
  .option("--low-stock-threshold <n>", "Alert when stock drops below this", parseInt)
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {
        productId: opts.product,
        name: opts.name,
      };
      if (opts.sku) body["sku"] = opts.sku;
      if (opts.priceDelta !== undefined) body["priceDelta"] = opts.priceDelta;
      if (opts.costPrice !== undefined) body["costPrice"] = opts.costPrice;
      if (opts.lowStockThreshold !== undefined) body["lowStockThreshold"] = opts.lowStockThreshold;

      const result = await apiRequest<Record<string, unknown>>("/inventory/variants", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const data = (result["data"] ?? result) as Record<string, unknown>;
        console.log(`Variant created: ${chalk.bold(String(data["id"]))}`);
        console.log(`Name: ${data["name"]}`);
        if (data["sku"]) console.log(`SKU: ${data["sku"]}`);
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

variants
  .command("list")
  .description("List variants for a product")
  .requiredOption("--product <id>", "Product ID")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/inventory/variants", {
        query: { productId: opts.product },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 24 },
          { key: "name", header: "Name", width: 24 },
          { key: "sku", header: "SKU", width: 20 },
          { key: "priceDelta", header: "Δ Price" },
          { key: "lowStockThreshold", header: "Alert ≤" },
          { key: "isDefault", header: "Default" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

variants
  .command("update <id>")
  .description("Update a variant")
  .option("--name <name>", "New name")
  .option("--sku <sku>", "New SKU code")
  .option("--price-delta <amount>", "New price delta", parseInt)
  .option("--cost-price <amount>", "New cost price", parseInt)
  .option("--low-stock-threshold <n>", "New threshold", parseInt)
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.name) body["name"] = opts.name;
      if (opts.sku !== undefined) body["sku"] = opts.sku;
      if (opts.priceDelta !== undefined) body["priceDelta"] = opts.priceDelta;
      if (opts.costPrice !== undefined) body["costPrice"] = opts.costPrice;
      if (opts.lowStockThreshold !== undefined) body["lowStockThreshold"] = opts.lowStockThreshold;

      const result = await apiRequest<Record<string, unknown>>(`/inventory/variants/${id}`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Variant ${id} updated.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

variants
  .command("delete <id>")
  .description("Archive a variant (default variant cannot be archived)")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/inventory/variants/${id}`, { method: "DELETE", sandbox: g.sandbox });
      if (g.json) {
        output({ archived: true, id }, { json: true });
      } else {
        console.log(chalk.green(`Variant ${id} archived.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Warehouses ──────────────────────────────────────────────

const warehouses = new Command("warehouses").description("Manage warehouses / stock locations");

warehouses
  .command("create")
  .description("Create a warehouse")
  .requiredOption("--name <name>", "Warehouse name")
  .option("--address <text>", "Street address")
  .option("--city <city>", "City")
  .option("--postal <code>", "Postal code")
  .option("--lat <n>", "Latitude", parseFloat)
  .option("--lng <n>", "Longitude", parseFloat)
  .option("--phone <phone>", "Contact phone")
  .option("--default", "Set as default warehouse")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.address) body["address"] = opts.address;
      if (opts.city) body["city"] = opts.city;
      if (opts.postal) body["postal"] = opts.postal;
      if (opts.lat !== undefined) body["lat"] = opts.lat;
      if (opts.lng !== undefined) body["lng"] = opts.lng;
      if (opts.phone) body["phone"] = opts.phone;
      if (opts.default) body["isDefault"] = true;

      const result = await apiRequest<Record<string, unknown>>("/inventory/warehouses", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const data = (result["data"] ?? result) as Record<string, unknown>;
        console.log(`Warehouse created: ${chalk.bold(String(data["id"]))}`);
        console.log(`Name: ${data["name"]}`);
        if (data["isDefault"]) console.log(chalk.dim("Default: yes"));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

warehouses
  .command("list")
  .description("List warehouses")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/inventory/warehouses", {
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 24 },
          { key: "name", header: "Name", width: 24 },
          { key: "city", header: "City", width: 16 },
          { key: "postal", header: "Postal" },
          { key: "isDefault", header: "Default" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

warehouses
  .command("update <id>")
  .description("Update a warehouse")
  .option("--name <name>", "New name")
  .option("--address <text>", "New street address")
  .option("--city <city>", "New city")
  .option("--postal <code>", "New postal code")
  .option("--lat <n>", "New latitude", parseFloat)
  .option("--lng <n>", "New longitude", parseFloat)
  .option("--phone <phone>", "New contact phone")
  .option("--default", "Make this the default warehouse (demotes current default)")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.name) body["name"] = opts.name;
      if (opts.address !== undefined) body["address"] = opts.address;
      if (opts.city !== undefined) body["city"] = opts.city;
      if (opts.postal !== undefined) body["postal"] = opts.postal;
      if (opts.lat !== undefined) body["lat"] = opts.lat;
      if (opts.lng !== undefined) body["lng"] = opts.lng;
      if (opts.phone !== undefined) body["phone"] = opts.phone;
      if (opts.default) body["isDefault"] = true;

      const result = await apiRequest<Record<string, unknown>>(`/inventory/warehouses/${id}`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Warehouse ${id} updated.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

warehouses
  .command("delete <id>")
  .description("Archive a warehouse (default warehouse cannot be archived)")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/inventory/warehouses/${id}`, { method: "DELETE", sandbox: g.sandbox });
      if (g.json) {
        output({ archived: true, id }, { json: true });
      } else {
        console.log(chalk.green(`Warehouse ${id} archived.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Stock ───────────────────────────────────────────────────

const stock = new Command("stock").description("Stock levels, adjustments, history, alerts");

stock
  .command("get")
  .description("Get stock for a variant across all warehouses")
  .requiredOption("--variant <id>", "Variant ID")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/inventory/stock", {
        query: { variantId: opts.variant },
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

stock
  .command("adjust")
  .description("Adjust stock (positive delta = receive, negative = remove)")
  .requiredOption("--variant <id>", "Variant ID")
  .requiredOption("--warehouse <id>", "Warehouse ID")
  .requiredOption("--delta <n>", "Stock delta (can be negative)", parseInt)
  .option(
    "--reason <reason>",
    "Reason: manual_adjust, refund_restock, transfer_in, transfer_out, damaged, returned_to_supplier, initial_stock, import",
    "manual_adjust"
  )
  .option("--note <text>", "Optional note")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {
        variantId: opts.variant,
        warehouseId: opts.warehouse,
        delta: opts.delta,
        reason: opts.reason,
      };
      if (opts.note) body["note"] = opts.note;

      const result = await apiRequest<Record<string, unknown>>("/inventory/adjust", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const data = (result["data"] ?? result) as Record<string, unknown>;
        const sign = opts.delta > 0 ? "+" : "";
        console.log(chalk.green(`Stock adjusted: ${sign}${opts.delta} (${opts.reason})`));
        if (data["id"]) console.log(chalk.dim(`Movement: ${String(data["id"])}`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

stock
  .command("history")
  .description("Stock movement history")
  .option("--variant <id>", "Filter by variant ID")
  .option("--warehouse <id>", "Filter by warehouse ID")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/inventory/movements", {
        query: {
          variantId: opts.variant,
          warehouseId: opts.warehouse,
          limit: opts.limit,
          cursor: opts.cursor,
        },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "createdAt", header: "When", width: 24 },
          { key: "delta", header: "Δ" },
          { key: "reason", header: "Reason", width: 20 },
          { key: "variantId", header: "Variant", width: 24 },
          { key: "warehouseId", header: "Warehouse", width: 24 },
          { key: "note", header: "Note", width: 30 },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

stock
  .command("alerts")
  .description("List low-stock alerts across all variants + warehouses")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/inventory/low-stock", {
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "productName", header: "Product", width: 24 },
          { key: "variantName", header: "Variant", width: 20 },
          { key: "sku", header: "SKU", width: 18 },
          { key: "warehouseName", header: "Warehouse", width: 18 },
          { key: "currentStock", header: "On hand" },
          { key: "threshold", header: "Threshold" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

stock
  .command("import")
  .description("Bulk import stock from a CSV file")
  .requiredOption("--file <path>", "Path to CSV file (columns: sku,name,productSlug,warehouseId,quantity,lowStockThreshold,costPrice)")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const csv = readFileSync(opts.file, "utf8");
      const result = await apiRequest<Record<string, unknown>>("/inventory/import", {
        method: "POST",
        body: { csv },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const data = (result["data"] ?? result) as Record<string, unknown>;
        console.log(chalk.green(`Imported: ${data["imported"] ?? 0}`));
        if (data["skipped"]) console.log(chalk.yellow(`Skipped: ${data["skipped"]}`));
        const errors = data["errors"] as string[] | undefined;
        if (errors && errors.length > 0) {
          console.log(chalk.red(`Errors:`));
          for (const e of errors) console.log(chalk.red(`  - ${e}`));
        }
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Top-level inventory command ─────────────────────────────

const inventory = new Command("inventory").description("Variants (SKUs), warehouses, stock");

inventory.addCommand(variants);
inventory.addCommand(warehouses);
inventory.addCommand(stock);

export { inventory };

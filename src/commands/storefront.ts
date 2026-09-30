import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { apiRequest, apiUrl, ApiClientError } from "../lib/api.js";
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

function parseMetadata(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    console.error(chalk.red("Error: --metadata must be a valid JSON string"));
    process.exit(1);
  }
}

// ─── Products ────────────────────────────────────────────────

const products = new Command("products").description("Manage products (digital, subscription, physical)");

products
  .command("create")
  .description("Create a product (digital, subscription, or physical)")
  .requiredOption("--name <name>", "Product name")
  .requiredOption("--price <amount>", "Price in smallest currency unit", parseInt)
  .requiredOption("--currency <code>", "Currency code")
  .option("--type <type>", "digital, subscription, or physical", "digital")
  .option("--slug <slug>", "URL slug")
  .option("--description <text>", "Product description")
  .option("--ai-generate", "Generate description, SEO, and OG image via AI")
  .option("--license-enabled", "Enable license key generation")
  .option("--max-activations <n>", "Max license activations per key", parseInt)
  .option("--published", "Make product page public")
  .option("--file <path>", "Path to file to upload")
  .option("--weight <grams>", "Weight in grams — required for physical", parseInt)
  .option("--length <cm>", "Length in cm (physical)", parseInt)
  .option("--width <cm>", "Width in cm (physical)", parseInt)
  .option("--height <cm>", "Height in cm (physical)", parseInt)
  .option("--origin-area <id>", "Biteship origin area ID override (physical)")
  .option("--requires-insurance", "Require buyer shipping insurance at checkout (physical)")
  .option("--metadata <json>", "JSON string")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      if (opts.type === "physical" && !opts.weight) {
        console.error(chalk.red("Error: --weight is required for physical products"));
        process.exit(1);
      }
      const body: Record<string, unknown> = {
        name: opts.name,
        price: opts.price,
        currency: opts.currency,
      };
      if (opts.type) body["type"] = opts.type;
      if (opts.slug) body["slug"] = opts.slug;
      if (opts.description) body["description"] = opts.description;
      if (opts.aiGenerate) body["aiGenerate"] = true;
      if (opts.licenseEnabled) body["licenseEnabled"] = true;
      if (opts.maxActivations !== undefined) body["maxActivations"] = opts.maxActivations;
      if (opts.published) body["published"] = true;
      if (opts.weight !== undefined) body["weight"] = opts.weight;
      if (opts.length !== undefined) body["length"] = opts.length;
      if (opts.width !== undefined) body["width"] = opts.width;
      if (opts.height !== undefined) body["height"] = opts.height;
      if (opts.originArea) body["originAreaId"] = opts.originArea;
      if (opts.requiresInsurance) body["requiresInsurance"] = true;
      if (opts.metadata) body["metadata"] = parseMetadata(opts.metadata);

      const result = await apiRequest<Record<string, unknown>>("/storefront/products", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      // Upload file if provided
      if (opts.file && result["id"]) {
        await uploadFile(String(result["id"]), opts.file, g.sandbox);
      }

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(`Product created: ${chalk.bold(String(result["id"]))}`);
        console.log(`Name: ${result["name"]}`);
        console.log(`Price: ${result["price"]} ${result["currency"]}`);
        if (result["slug"]) console.log(`Slug: ${result["slug"]}`);
        if (opts.file) console.log(chalk.dim("File uploaded."));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

products
  .command("list")
  .description("List products")
  .option("--published", "Filter by published status")
  .option("--type <type>", "Filter: digital, subscription, physical")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/storefront/products", {
        query: { published: opts.published ? "true" : undefined, type: opts.type, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "name", header: "Name", width: 30 },
          { key: "price", header: "Price" },
          { key: "currency", header: "Currency" },
          { key: "published", header: "Published" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

products
  .command("get <id>")
  .description("Get a product")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/storefront/products/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

products
  .command("update <id>")
  .description("Update a product")
  .option("--name <name>", "New name")
  .option("--price <amount>", "New price", parseInt)
  .option("--description <text>", "New description")
  .option("--published", "Toggle visibility on")
  .option("--no-published", "Toggle visibility off")
  .option("--license-enabled", "Toggle license keys on")
  .option("--no-license-enabled", "Toggle license keys off")
  .option("--max-activations <n>", "Update activation limit", parseInt)
  .option("--weight <grams>", "New weight in grams (physical)", parseInt)
  .option("--length <cm>", "New length in cm (physical)", parseInt)
  .option("--width <cm>", "New width in cm (physical)", parseInt)
  .option("--height <cm>", "New height in cm (physical)", parseInt)
  .option("--origin-area <id>", "New Biteship origin area ID (physical)")
  .option("--requires-insurance", "Require buyer shipping insurance")
  .option("--no-requires-insurance", "Don't require buyer shipping insurance")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.name) body["name"] = opts.name;
      if (opts.price !== undefined) body["price"] = opts.price;
      if (opts.description) body["description"] = opts.description;
      if (opts.published !== undefined) body["published"] = opts.published;
      if (opts.licenseEnabled !== undefined) body["licenseEnabled"] = opts.licenseEnabled;
      if (opts.maxActivations !== undefined) body["maxActivations"] = opts.maxActivations;
      if (opts.weight !== undefined) body["weight"] = opts.weight;
      if (opts.length !== undefined) body["length"] = opts.length;
      if (opts.width !== undefined) body["width"] = opts.width;
      if (opts.height !== undefined) body["height"] = opts.height;
      if (opts.originArea) body["originAreaId"] = opts.originArea;
      if (opts.requiresInsurance !== undefined) body["requiresInsurance"] = opts.requiresInsurance;

      const result = await apiRequest<Record<string, unknown>>(`/storefront/products/${id}`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Product ${id} updated.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

products
  .command("delete <id>")
  .description("Archive a product")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/storefront/products/${id}`, { method: "DELETE", sandbox: g.sandbox });
      if (g.json) {
        output({ deleted: true, id }, { json: true });
      } else {
        console.log(chalk.green(`Product ${id} archived.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

async function uploadFile(productId: string, filePath: string, sandbox?: boolean): Promise<void> {
  const { resolveApiKey } = await import("../lib/config.js");
  const token = resolveApiKey({ sandbox });
  const url = apiUrl(`/storefront/products/${productId}/files`).toString();

  const fileData = readFileSync(filePath);
  const fileName = filePath.split("/").pop() ?? "file";

  const formData = new FormData();
  formData.append("file", new Blob([fileData]), fileName);

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    let errorBody: { message?: string; code?: string } = {};
    try {
      errorBody = (await response.json()) as { message?: string; code?: string };
    } catch {
      // not JSON
    }
    throw new ApiClientError({
      status: response.status,
      message: errorBody.message ?? `Upload failed with status ${response.status}`,
      code: errorBody.code,
    });
  }
}

products
  .command("upload <id>")
  .description("Upload a file to a product")
  .requiredOption("--file <path>", "Path to file (max 500 MB)")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await uploadFile(id, opts.file, g.sandbox);
      if (g.json) {
        output({ uploaded: true, productId: id, file: opts.file }, { json: true });
      } else {
        console.log(chalk.green(`File uploaded to product ${id}.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// AI description generation — async on the backend. POST /ai-generate
// returns 202 + kicks off Gemini in the background; the worker writes
// the new description (and SEO metadata) straight back to the product.
// There's no synchronous text return and no per-request tone/length
// knobs server-side, so the CLI shape is: fire the job, then poll
// GET /:id until aiStatus is "completed" or "failed". The description
// is always applied — `--no-wait` skips the poll for scripts that just
// want to queue the job.
products
  .command("generate-description <id>")
  .description("Generate a product description with AI (writes back to the product)")
  .option("--no-wait", "Return immediately after queueing; don't poll for completion")
  .option("--timeout <seconds>", "Max seconds to wait for completion (default 60)", parseInt)
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest<Record<string, unknown>>(`/storefront/products/${id}/ai-generate`, {
        method: "POST",
        sandbox: g.sandbox,
      });

      if (opts.wait === false) {
        if (g.json) {
          output({ productId: id, aiStatus: "generating", queued: true }, { json: true });
        } else {
          console.log(chalk.dim(`AI generation queued for product ${id}.`));
        }
        return;
      }

      const timeoutMs = (opts.timeout && opts.timeout > 0 ? opts.timeout : 60) * 1000;
      const pollIntervalMs = 1500;
      const deadline = Date.now() + timeoutMs;

      let product: Record<string, unknown> | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        const polled = await apiRequest<Record<string, unknown>>(
          `/storefront/products/${id}`,
          { sandbox: g.sandbox },
        );
        const status = polled["aiStatus"];
        if (status === "completed" || status === "failed") {
          product = polled;
          break;
        }
      }

      if (!product) {
        if (g.json) {
          output({ productId: id, aiStatus: "generating", timedOut: true }, { json: true });
        } else {
          console.error(chalk.yellow(`Timed out waiting for AI generation. Re-run \`storefront products get ${id}\` to check status.`));
        }
        process.exit(1);
      }

      if (product["aiStatus"] === "failed") {
        if (g.json) {
          output(product, { json: true });
        } else {
          console.error(chalk.red("AI generation failed. Check backend logs."));
        }
        process.exit(1);
      }

      if (g.json) {
        output(product, { json: true });
      } else {
        console.log(chalk.green(`AI generation complete for product ${id}.`));
        console.log();
        console.log(chalk.bold("Description:"));
        console.log(String(product["description"] ?? ""));
        const md = product["metadata"];
        if (md && typeof md === "object") {
          const meta = md as Record<string, unknown>;
          if (meta["seoTitle"]) console.log(`\n${chalk.bold("SEO Title:")} ${meta["seoTitle"]}`);
          if (meta["seoDescription"]) console.log(`${chalk.bold("SEO Description:")} ${meta["seoDescription"]}`);
          if (Array.isArray(meta["featureBullets"]) && meta["featureBullets"].length > 0) {
            console.log(chalk.bold("\nFeature Bullets:"));
            for (const b of meta["featureBullets"] as unknown[]) {
              console.log(`  - ${String(b)}`);
            }
          }
        }
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Licenses ────────────────────────────────────────────────

const licenses = new Command("licenses").description("Manage license keys");

licenses
  .command("list")
  .description("List licenses")
  .option("--product <id>", "Filter by product ID")
  .option("--customer <id>", "Filter by customer ID")
  .option("--status <status>", "Filter: active, revoked")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/storefront/licenses", {
        query: { product: opts.product, customer: opts.customer, status: opts.status, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "key", header: "Key", width: 24 },
          { key: "productId", header: "Product", width: 20 },
          { key: "status", header: "Status" },
          { key: "activations", header: "Activations" },
          { key: "createdAt", header: "Created" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

licenses
  .command("get <key>")
  .description("Get a license by key")
  .action(async (key: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/storefront/licenses/${key}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

licenses
  .command("validate <key>")
  .description("Validate a license key (public, no auth required)")
  .option("--product <id>", "Validate against specific product ID")
  .action(async (key: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      // Public endpoint — uses direct fetch without auth
      const url = apiUrl("/storefront/licenses/validate");
      url.searchParams.set("key", key);
      if (opts.product) url.searchParams.set("product", opts.product);

      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        let errorBody: { message?: string; code?: string } = {};
        try {
          errorBody = (await response.json()) as { message?: string; code?: string };
        } catch {
          // not JSON
        }
        throw new ApiClientError({
          status: response.status,
          message: errorBody.message ?? `Validation failed with status ${response.status}`,
          code: errorBody.code,
        });
      }

      const result = (await response.json()) as Record<string, unknown>;

      if (g.json) {
        output(result, { json: true });
      } else {
        output({
          License: key,
          Valid: result["valid"] ?? "-",
          Status: result["status"] ?? "-",
          Product: result["productName"] ? `${result["productName"]} (${result["productId"]})` : (result["productId"] ?? "-"),
          Activations: result["maxActivations"] ? `${result["activations"]}/${result["maxActivations"]}` : String(result["activations"] ?? "-"),
          Expires: result["expiresAt"] ?? "never",
        });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

licenses
  .command("revoke <key>")
  .description("Revoke a license key")
  .action(async (key: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/storefront/licenses/${key}`, { method: "DELETE", sandbox: g.sandbox });
      if (g.json) {
        output({ revoked: true, key }, { json: true });
      } else {
        console.log(chalk.green(`License ${key} revoked.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Deliveries ──────────────────────────────────────────────

const deliveries = new Command("deliveries").description("Manage deliveries");

deliveries
  .command("list")
  .description("List deliveries")
  .option("--product <id>", "Filter by product ID")
  .option("--customer <id>", "Filter by customer ID")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/storefront/deliveries", {
        query: { product: opts.product, customer: opts.customer, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "productId", header: "Product", width: 20 },
          { key: "customerId", header: "Customer", width: 20 },
          { key: "status", header: "Status" },
          { key: "createdAt", header: "Created" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

deliveries
  .command("get <id>")
  .description("Get a delivery")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/storefront/deliveries/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Top-level storefront command ────────────────────────────

const storefront = new Command("storefront").description("Manage storefront products, licenses, and deliveries");

storefront.addCommand(products);
storefront.addCommand(licenses);
storefront.addCommand(deliveries);

export { storefront };

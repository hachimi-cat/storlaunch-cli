import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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

function parseMetadata(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    console.error(chalk.red("Error: --metadata must be a valid JSON string"));
    process.exit(1);
  }
}

function parseCommaSeparated(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").map((s) => s.trim());
}

// ─── Checkout ────────────────────────────────────────────────

const checkout = new Command("checkout").description("Manage checkout sessions");

checkout
  .command("create")
  .description("Create a checkout session")
  .requiredOption("--amount <amount>", "Amount in smallest currency unit", parseInt)
  .requiredOption("--currency <code>", "Currency code (IDR, USD)")
  .option("--description <text>", "Shown on checkout page")
  .option("--customer <id>", "Customer ID")
  .option("--customer-email <email>", "Pre-fill email")
  .option("--success-url <url>", "Redirect URL after payment")
  .option("--cancel-url <url>", "Redirect URL on cancel")
  .option("--expires-in <minutes>", "Session expiry in minutes", parseInt)
  .option("--payment-methods <methods>", "Comma-separated: qris,ewallet,va,card,paypal")
  .option("--metadata <json>", "JSON key-value pairs")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {
        amount: opts.amount,
        currency: opts.currency,
      };
      if (opts.description) body["description"] = opts.description;
      if (opts.customer) body["customerId"] = opts.customer;
      if (opts.customerEmail) body["customerEmail"] = opts.customerEmail;
      if (opts.successUrl) body["successUrl"] = opts.successUrl;
      if (opts.cancelUrl) body["cancelUrl"] = opts.cancelUrl;
      if (opts.expiresIn) body["expiresInMinutes"] = opts.expiresIn;
      if (opts.paymentMethods) body["paymentMethods"] = parseCommaSeparated(opts.paymentMethods);
      if (opts.metadata) body["metadata"] = parseMetadata(opts.metadata);

      const result = await apiRequest<Record<string, unknown>>("/payment/checkout-sessions", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(`Checkout session created: ${chalk.bold(String(result["id"]))}`);
        if (result["url"]) console.log(`URL: ${result["url"]}`);
        console.log(`Status: ${result["status"]}`);
        if (result["expiresAt"]) console.log(`Expires: ${result["expiresAt"]}`);
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

checkout
  .command("list")
  .description("List checkout sessions")
  .option("--status <status>", "Filter: open, completed, expired")
  .option("--customer <id>", "Filter by customer ID")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payment/checkout-sessions", {
        query: { status: opts.status, customer: opts.customer, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 24 },
          { key: "amount", header: "Amount" },
          { key: "currency", header: "Currency" },
          { key: "status", header: "Status" },
          { key: "createdAt", header: "Created" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

checkout
  .command("get <id>")
  .description("Get a checkout session")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/checkout-sessions/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Plans ───────────────────────────────────────────────────

const plans = new Command("plans").description("Manage subscription plans");

plans
  .command("create")
  .description("Create a subscription plan")
  .requiredOption("--name <name>", "Plan display name")
  .requiredOption("--amount <amount>", "Amount per interval", parseInt)
  .requiredOption("--currency <code>", "Currency code")
  .requiredOption("--interval <interval>", "weekly, monthly, or yearly")
  .option("--description <text>", "Plan description")
  .option("--trial-days <days>", "Free trial duration", parseInt)
  .option("--features <list>", "Comma-separated feature list")
  .option("--metadata <json>", "JSON string")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {
        name: opts.name,
        amount: opts.amount,
        currency: opts.currency,
        interval: opts.interval,
      };
      if (opts.description) body["description"] = opts.description;
      if (opts.trialDays !== undefined) body["trialDays"] = opts.trialDays;
      if (opts.features) body["features"] = parseCommaSeparated(opts.features);
      if (opts.metadata) body["metadata"] = parseMetadata(opts.metadata);

      const result = await apiRequest<Record<string, unknown>>("/payment/plans", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(`Plan created: ${chalk.bold(String(result["id"]))}`);
        console.log(`Name: ${result["name"]}`);
        console.log(`Amount: ${result["amount"]} ${result["currency"]}`);
        console.log(`Interval: ${result["interval"]}`);
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

plans
  .command("list")
  .description("List subscription plans")
  .option("--active", "Filter by active status")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payment/plans", {
        query: { active: opts.active ? "true" : undefined, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "name", header: "Name" },
          { key: "amount", header: "Amount" },
          { key: "currency", header: "Currency" },
          { key: "interval", header: "Interval" },
          { key: "active", header: "Active" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

plans
  .command("get <id>")
  .description("Get a plan")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/plans/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

plans
  .command("update <id>")
  .description("Update a plan")
  .option("--name <name>", "New plan name")
  .option("--amount <amount>", "New amount", parseInt)
  .option("--description <text>", "New description")
  .option("--trial-days <days>", "New trial duration", parseInt)
  .option("--features <list>", "Comma-separated feature list")
  .option("--active", "Enable the plan")
  .option("--no-active", "Disable the plan")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.name) body["name"] = opts.name;
      if (opts.amount !== undefined) body["amount"] = opts.amount;
      if (opts.description) body["description"] = opts.description;
      if (opts.trialDays !== undefined) body["trialDays"] = opts.trialDays;
      if (opts.features) body["features"] = parseCommaSeparated(opts.features);
      if (opts.active !== undefined) body["active"] = opts.active;

      const result = await apiRequest<Record<string, unknown>>(`/payment/plans/${id}`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Plan ${id} updated.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

plans
  .command("delete <id>")
  .description("Archive a plan")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/payment/plans/${id}`, { method: "DELETE", sandbox: g.sandbox });
      if (g.json) {
        output({ deleted: true, id }, { json: true });
      } else {
        console.log(chalk.green(`Plan ${id} archived.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Subscriptions ───────────────────────────────────────────

const subscriptions = new Command("subscriptions").description("Manage subscriptions");

subscriptions
  .command("create")
  .description("Create a subscription")
  .requiredOption("--customer <id>", "Customer ID")
  .requiredOption("--plan <id>", "Plan ID")
  .option("--payment-method <method>", "Preferred payment method")
  .option("--trial-end <date>", "Override trial period (ISO 8601)")
  .option("--metadata <json>", "JSON string")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {
        customerId: opts.customer,
        planId: opts.plan,
      };
      if (opts.paymentMethod) body["paymentMethod"] = opts.paymentMethod;
      if (opts.trialEnd) body["trialEnd"] = opts.trialEnd;
      if (opts.metadata) body["metadata"] = parseMetadata(opts.metadata);

      const result = await apiRequest<Record<string, unknown>>("/payment/subscriptions", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(`Subscription created: ${chalk.bold(String(result["id"]))}`);
        console.log(`Status: ${result["status"]}`);
        console.log(`Plan: ${result["planId"]}`);
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

subscriptions
  .command("list")
  .description("List subscriptions")
  .option("--customer <id>", "Filter by customer ID")
  .option("--plan <id>", "Filter by plan ID")
  .option("--status <status>", "Filter: trialing, active, past_due, paused, canceled")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payment/subscriptions", {
        query: { customer: opts.customer, plan: opts.plan, status: opts.status, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "customerId", header: "Customer", width: 20 },
          { key: "planId", header: "Plan", width: 20 },
          { key: "status", header: "Status" },
          { key: "currentPeriodEnd", header: "Period End" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

subscriptions
  .command("get <id>")
  .description("Get a subscription")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/subscriptions/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

subscriptions
  .command("update <id>")
  .description("Update a subscription plan")
  .option("--plan <id>", "New plan ID")
  .option("--prorate", "Apply proration immediately")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.plan) body["planId"] = opts.plan;
      if (opts.prorate) body["prorate"] = true;

      const result = await apiRequest<Record<string, unknown>>(`/payment/subscriptions/${id}`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Subscription ${id} updated.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

subscriptions
  .command("cancel <id>")
  .description("Cancel a subscription")
  .option("--immediate", "Cancel now instead of at period end")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/payment/subscriptions/${id}`, {
        method: "DELETE",
        body: opts.immediate ? { immediate: true } : undefined,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output({ canceled: true, id, immediate: !!opts.immediate }, { json: true });
      } else {
        const mode = opts.immediate ? "immediately" : "at period end";
        console.log(chalk.green(`Subscription ${id} canceled ${mode}.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

subscriptions
  .command("pause <id>")
  .description("Pause a subscription")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/subscriptions/${id}`, {
        method: "PATCH",
        body: { status: "paused" },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Subscription ${id} paused.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

subscriptions
  .command("resume <id>")
  .description("Resume a paused subscription")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/subscriptions/${id}`, {
        method: "PATCH",
        body: { status: "active" },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Subscription ${id} resumed.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Invoices ────────────────────────────────────────────────

const invoices = new Command("invoices").description("Manage invoices");

invoices
  .command("list")
  .description("List invoices")
  .option("--customer <id>", "Filter by customer ID")
  .option("--subscription <id>", "Filter by subscription ID")
  .option("--status <status>", "Filter: draft, open, paid, overdue, void")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payment/invoices", {
        query: { customer: opts.customer, subscription: opts.subscription, status: opts.status, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "amount", header: "Amount" },
          { key: "currency", header: "Currency" },
          { key: "status", header: "Status" },
          { key: "createdAt", header: "Created" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

invoices
  .command("get <id>")
  .description("Get an invoice")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/invoices/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

invoices
  .command("download <id>")
  .description("Download invoice as PDF")
  .option("--output <path>", "Output file path")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      // Get invoice details first to determine filename
      const invoice = await apiRequest<Record<string, unknown>>(`/payment/invoices/${id}`, {
        sandbox: g.sandbox,
      });

      const outputPath = opts.output ?? `./${invoice["number"] ?? id}.pdf`;

      // Download the PDF
      const { resolveApiKey, resolveApiUrl } = await import("../lib/config.js");
      const token = resolveApiKey({ sandbox: g.sandbox });
      const baseUrl = resolveApiUrl();
      const url = `${baseUrl.replace(/\/$/, "")}/payment/invoices/${id}/pdf`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new ApiClientError({
          status: response.status,
          message: `Failed to download invoice: ${response.statusText}`,
        });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, buffer);

      if (g.json) {
        output({ id, path: outputPath, size: buffer.length }, { json: true });
      } else {
        console.log(chalk.green(`Invoice downloaded: ${outputPath} (${buffer.length} bytes)`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Customers ───────────────────────────────────────────────

const customers = new Command("customers").description("Manage customers");

customers
  .command("create")
  .description("Create a customer")
  .requiredOption("--email <email>", "Customer email")
  .option("--name <name>", "Display name")
  .option("--metadata <json>", "JSON string")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = { email: opts.email };
      if (opts.name) body["name"] = opts.name;
      if (opts.metadata) body["metadata"] = parseMetadata(opts.metadata);

      const result = await apiRequest<Record<string, unknown>>("/payment/customers", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(`Customer created: ${chalk.bold(String(result["id"]))}`);
        console.log(`Email: ${result["email"]}`);
        if (result["name"]) console.log(`Name: ${result["name"]}`);
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

customers
  .command("list")
  .description("List customers")
  .option("--email <email>", "Filter by exact email")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payment/customers", {
        query: { email: opts.email, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "email", header: "Email", width: 30 },
          { key: "name", header: "Name" },
          { key: "createdAt", header: "Created" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

customers
  .command("get <id>")
  .description("Get a customer")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/customers/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

customers
  .command("update <id>")
  .description("Update a customer")
  .option("--name <name>", "New display name")
  .option("--email <email>", "New email")
  .option("--metadata <json>", "JSON string")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.name) body["name"] = opts.name;
      if (opts.email) body["email"] = opts.email;
      if (opts.metadata) body["metadata"] = parseMetadata(opts.metadata);

      const result = await apiRequest<Record<string, unknown>>(`/payment/customers/${id}`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Customer ${id} updated.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Portal ──────────────────────────────────────────────────

const portal = new Command("portal").description("Manage billing portal sessions");

portal
  .command("create")
  .description("Create a billing portal session")
  .requiredOption("--customer <id>", "Customer ID")
  .option("--return-url <url>", "Redirect when customer is done")
  .option("--expires-in <minutes>", "Session duration in minutes", parseInt)
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = { customerId: opts.customer };
      if (opts.returnUrl) body["returnUrl"] = opts.returnUrl;
      if (opts.expiresIn) body["expiresInMinutes"] = opts.expiresIn;

      const result = await apiRequest<Record<string, unknown>>("/payment/portal-sessions", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(`Portal session created: ${chalk.bold(String(result["id"]))}`);
        if (result["url"]) console.log(`URL: ${result["url"]}`);
        if (result["expiresAt"]) console.log(`Expires: ${result["expiresAt"]}`);
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Top-level payment command ───────────────────────────────

const payment = new Command("payment").description("Manage payments, plans, subscriptions, and customers");

payment.addCommand(checkout);
payment.addCommand(plans);
payment.addCommand(subscriptions);
payment.addCommand(invoices);
payment.addCommand(customers);
payment.addCommand(portal);

export { payment };

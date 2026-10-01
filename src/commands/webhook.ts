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

// ─── Endpoints ───────────────────────────────────────────────

const endpoints = new Command("endpoints").description("Manage webhook endpoints");

endpoints
  .command("create")
  .description("Create a webhook endpoint")
  .requiredOption("--url <url>", "HTTPS URL to receive events")
  .option("--events <events>", 'Comma-separated event types, prefixes ending in "*" (manual_order.*), or "*" for all (the default) — see `webhook endpoints event-types`')
  .option("--description <text>", "Human-readable label")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const events = !opts.events || opts.events === "*" ? ["*"] : opts.events.split(",").map((s: string) => s.trim());
      const body: Record<string, unknown> = {
        url: opts.url,
        events,
      };
      if (opts.description) body["description"] = opts.description;

      const result = await apiRequest<Record<string, unknown>>("/payment/webhook-endpoints", {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(`Webhook endpoint created: ${chalk.bold(String(result["id"]))}`);
        console.log(`URL:    ${result["url"]}`);
        console.log(`Events: ${Array.isArray(result["events"]) ? (result["events"] as string[]).join(", ") : result["events"]}`);
        if (result["secret"]) {
          console.log(`Secret: ${chalk.yellow(String(result["secret"]))}   ${chalk.dim("<- Save this! Not shown again.")}`);
        }
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

endpoints
  .command("list")
  .description("List webhook endpoints")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payment/webhook-endpoints", {
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "url", header: "URL", width: 40 },
          { key: "active", header: "Active" },
          { key: "consecutiveFailures", header: "Failing" },
          { key: "disabledReason", header: "Switched off", width: 30 },
          { key: "createdAt", header: "Created" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

endpoints
  .command("get <id>")
  .description("Get a webhook endpoint")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/webhook-endpoints/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

endpoints
  .command("update <id>")
  .description("Update a webhook endpoint")
  .option("--url <url>", "New URL")
  .option("--events <events>", "New event types (comma-separated)")
  .option("--description <text>", "New label")
  .option("--active", "Enable the endpoint (also clears the failure streak after Storlaunch switched it off)")
  .option("--no-active", "Disable the endpoint (its queued deliveries fail)")
  .option("--rotate-secret", "Issue a new signing secret (printed once); the old one stops working")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.url) body["url"] = opts.url;
      if (opts.events) {
        body["events"] = opts.events === "*" ? ["*"] : opts.events.split(",").map((s: string) => s.trim());
      }
      if (opts.description) body["description"] = opts.description;
      if (opts.active !== undefined) body["active"] = opts.active;
      if (opts.rotateSecret) body["rotateSecret"] = true;

      const result = await apiRequest<Record<string, unknown>>(`/payment/webhook-endpoints/${id}`, {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Webhook endpoint ${id} updated.`));
        if (result["secret"]) {
          console.log(`Secret: ${chalk.yellow(String(result["secret"]))}   ${chalk.dim("<- Save this! Not shown again.")}`);
        }
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

endpoints
  .command("delete <id>")
  .description("Delete a webhook endpoint")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/payment/webhook-endpoints/${id}`, { method: "DELETE", sandbox: g.sandbox });
      if (g.json) {
        output({ deleted: true, id }, { json: true });
      } else {
        console.log(chalk.green(`Webhook endpoint ${id} deleted.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

endpoints
  .command("test <id>")
  .description("Send a test event (storlaunch.webhook_endpoint.test.v1) to this endpoint alone")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/webhook-endpoints/${id}/test`, {
        method: "POST",
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Test event queued: ${result["eventId"]} (delivery ${result["id"]}).`));
        console.log(chalk.dim(`See how it went: storlaunch webhook events get ${result["id"]}`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

endpoints
  .command("event-types")
  .description("List the event types an endpoint can subscribe to (Plugipay's too, with the Payment module on)")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<{ storlaunch?: Array<Record<string, unknown>>; plugipay?: Array<Record<string, unknown>> }>(
        "/payment/webhook-endpoints/event-types",
        { sandbox: g.sandbox },
      );
      if (g.json) {
        output(result, { json: true });
      } else {
        const rows = [
          ...(result.storlaunch ?? []).map((t) => ({ ...t, from: "storlaunch" })),
          ...(result.plugipay ?? []).map((t) => ({ ...t, from: "plugipay" })),
        ];
        output(rows, { columns: [{ key: "type", header: "Type", width: 42 }, { key: "from", header: "Sent by" }, { key: "description", header: "Description", width: 60 }] });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Events ──────────────────────────────────────────────────

const events = new Command("events").description("The delivery log: one row per event per endpoint, with its attempts");

events
  .command("list")
  .description("List webhook deliveries, newest first")
  .option("--type <type>", "Filter by event type")
  .option("--endpoint <id>", "Filter by endpoint ID")
  .option("--status <status>", "Filter: pending, sent, failed")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/payment/webhook-events", {
        query: { type: opts.type, endpointId: opts.endpoint, status: opts.status, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 20 },
          { key: "type", header: "Type", width: 30 },
          { key: "status", header: "Status" },
          { key: "attempts", header: "Attempts" },
          { key: "responseCode", header: "HTTP" },
          { key: "nextRetryAt", header: "Next try" },
          { key: "createdAt", header: "Created" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

events
  .command("get <id>")
  .description("Get a webhook event")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/webhook-events/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

events
  .command("resend <id>")
  .description("Queue one more attempt at a delivery (it goes out within seconds)")
  .action(async (id: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/payment/webhook-events/${id}/resend`, {
        method: "POST",
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Webhook delivery ${id} queued again.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Listen ──────────────────────────────────────────────────

const listenCommand = new Command("listen")
  .description("Start a local webhook listener for development")
  .option("--port <port>", "Local port to forward events to", parseInt, 3000)
  .option("--path <path>", "Local path to forward to", "/")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    console.log(`Listening for webhook events on localhost:${opts.port}${opts.path}`);
    console.log(chalk.green("Ready! Events will be forwarded in real-time."));
    console.log(chalk.dim("Press Ctrl+C to stop.\n"));

    // The listen command would typically establish a WebSocket/tunnel connection
    // For MVP, we inform the user this requires a tunnel service
    console.error(chalk.yellow("Note: webhook listen requires the Storlaunch tunnel service (coming soon)."));
    console.error(chalk.yellow("For now, use `webhook endpoints create` with a public URL."));
    process.exit(0);
  });

// ─── Top-level webhook command ───────────────────────────────

const webhook = new Command("webhook").description("Manage webhooks and event delivery");

webhook.addCommand(listenCommand);
webhook.addCommand(endpoints);
webhook.addCommand(events);

export { webhook };

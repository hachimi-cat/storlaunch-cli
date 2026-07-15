import { Command } from "commander";
import chalk from "chalk";
import { apiRequest, ApiClientError } from "../lib/api.js";
import { resolveApiUrl } from "../lib/config.js";
import { output, type Column } from "../lib/output.js";

/**
 * `sell shipping` — merchant shipping config (origin + enabled couriers),
 * area lookup, shipments list/cancel/label, waybill tracking. Fronts the
 * /shipping/* endpoints.
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

// ─── Origin ──────────────────────────────────────────────────

const origin = new Command("origin").description("Get or set merchant shipping origin");

origin
  .command("get")
  .description("Show the current origin config")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/shipping/origin", {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

origin
  .command("set")
  .description("Set the origin — required before quoting rates or creating shipments")
  .requiredOption("--address <text>", "Full street address")
  .requiredOption("--contact-name <name>", "Origin contact name")
  .requiredOption("--contact-phone <phone>", "Origin contact phone")
  .option("--province <name>", "Province")
  .option("--city <name>", "City")
  .option("--district <name>", "Kecamatan")
  .option("--village <name>", "Kelurahan")
  .option("--postal <code>", "Postal code")
  .option("--area <id>", "Biteship area ID (lookup via `shipping areas search`)")
  .option("--lat <n>", "Latitude (required for instant couriers)", parseFloat)
  .option("--lng <n>", "Longitude (required for instant couriers)", parseFloat)
  .option("--note <text>", "Pickup note")
  .option(
    "--couriers <codes>",
    "Comma-separated courier codes (e.g. jne,jnt,sicepat). Omit to keep current list."
  )
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {
        address: opts.address,
        contactName: opts.contactName,
        contactPhone: opts.contactPhone,
      };
      if (opts.province) body["province"] = opts.province;
      if (opts.city) body["city"] = opts.city;
      if (opts.district) body["district"] = opts.district;
      if (opts.village) body["village"] = opts.village;
      if (opts.postal) body["postal"] = opts.postal;
      if (opts.area) body["areaId"] = opts.area;
      if (opts.lat !== undefined) body["lat"] = opts.lat;
      if (opts.lng !== undefined) body["lng"] = opts.lng;
      if (opts.note) body["note"] = opts.note;
      if (opts.couriers) {
        body["couriers"] = String(opts.couriers)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const result = await apiRequest<Record<string, unknown>>("/shipping/origin", {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green("Shipping origin updated."));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Couriers ────────────────────────────────────────────────

const couriers = new Command("couriers").description("Show available couriers from Biteship catalog");

couriers
  .command("list")
  .description("List all couriers (public — no auth required)")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const baseUrl = resolveApiUrl();
      const url = new URL("/shipping/couriers", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
      const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!response.ok) {
        let errorBody: { message?: string; code?: string } = {};
        try { errorBody = (await response.json()) as { message?: string; code?: string }; } catch { /* ignore */ }
        throw new ApiClientError({
          status: response.status,
          message: errorBody.message ?? `Request failed with status ${response.status}`,
          code: errorBody.code,
        });
      }
      const result = (await response.json()) as Record<string, unknown>;

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "courier_code", header: "Code", width: 16 },
          { key: "courier_name", header: "Name", width: 24 },
          { key: "service_code", header: "Service", width: 16 },
          { key: "service_type", header: "Type" },
          { key: "shipment_duration_range", header: "ETA" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Areas ───────────────────────────────────────────────────

const areas = new Command("areas").description("Search Biteship areas (for origin areaId lookup)");

areas
  .command("search <query>")
  .description("Search for an area by city/postal (min 2 chars)")
  .action(async (query: string, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/shipping/areas", {
        query: { q: query },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "areaId", header: "Area ID", width: 20 },
          { key: "areaName", header: "Name", width: 40 },
          { key: "lat", header: "Lat" },
          { key: "lng", header: "Lng" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Shipments ───────────────────────────────────────────────

const shipments = new Command("shipments").description("Manage physical shipments");

shipments
  .command("list")
  .description("List shipments")
  .option("--status <status>", "Filter by status (pending, confirmed, picked_up, delivered, cancelled, ...)")
  .option("--limit <n>", "Items per page", parseInt)
  .option("--cursor <cursor>", "Pagination cursor")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/shipping/shipments", {
        query: { status: opts.status, limit: opts.limit, cursor: opts.cursor },
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const cols: Column[] = [
          { key: "id", header: "ID", width: 24 },
          { key: "status", header: "Status", width: 14 },
          { key: "courierCode", header: "Courier", width: 12 },
          { key: "courierServiceCode", header: "Service", width: 14 },
          { key: "waybillId", header: "AWB", width: 20 },
          { key: "createdAt", header: "Created" },
        ];
        output((result["data"] ?? result) as unknown, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

shipments
  .command("get <id>")
  .description("Get a shipment detail (includes tracking events)")
  .action(async (id: string, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/shipping/shipments/${id}`, {
        sandbox: g.sandbox,
      });
      output(result, { json: g.json });
    } catch (err) {
      handleError(err, g.json);
    }
  });

shipments
  .command("cancel <id>")
  .description("Cancel a shipment (only before pickup)")
  .option("--reason <text>", "Cancellation reason")
  .action(async (id: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.reason) body["reason"] = opts.reason;
      const result = await apiRequest<Record<string, unknown>>(`/shipping/shipments/${id}/cancel`, {
        method: "POST",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Shipment ${id} cancelled.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

shipments
  .command("label <id>")
  .description("Print the shipping label URL (lazy-fetched from courier on first call)")
  .action(async (id: string, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(`/shipping/shipments/${id}/label`, {
        sandbox: g.sandbox,
      });

      if (g.json) {
        output(result, { json: true });
      } else {
        const data = (result["data"] ?? result) as Record<string, unknown>;
        if (data["url"]) {
          console.log(String(data["url"]));
        } else {
          console.log(chalk.yellow("Label not ready yet."));
        }
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── Tracking ────────────────────────────────────────────────

// `track <waybill>` lives on the shipping root so merchants can track any
// waybill without descending into shipments (e.g. for 3rd-party waybills).

// ─── Top-level shipping command ──────────────────────────────

const shipping = new Command("shipping").description("Origin config, couriers, shipments, tracking");

shipping.addCommand(origin);
shipping.addCommand(couriers);
shipping.addCommand(areas);
shipping.addCommand(shipments);

shipping
  .command("track <waybill>")
  .description("Track a waybill (public endpoint)")
  .option("--courier <code>", "Courier code (required if waybill not in our DB)")
  .action(async (waybill: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const baseUrl = resolveApiUrl();
      const url = new URL(
        `/shipping/track/${encodeURIComponent(waybill)}`,
        baseUrl.endsWith("/") ? baseUrl : baseUrl + "/"
      );
      if (opts.courier) url.searchParams.set("courier", opts.courier);

      const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!response.ok) {
        let errorBody: { message?: string; code?: string } = {};
        try { errorBody = (await response.json()) as { message?: string; code?: string }; } catch { /* ignore */ }
        throw new ApiClientError({
          status: response.status,
          message: errorBody.message ?? `Tracking failed with status ${response.status}`,
          code: errorBody.code,
        });
      }
      const result = (await response.json()) as Record<string, unknown>;

      if (g.json) {
        output(result, { json: true });
      } else {
        const data = (result["data"] ?? result) as Record<string, unknown>;
        console.log(`${chalk.bold("Waybill:")} ${data["waybillId"] ?? waybill}`);
        console.log(`${chalk.bold("Courier:")} ${data["courier"] ?? "-"}`);
        console.log(`${chalk.bold("Status:")} ${data["status"] ?? "-"}`);
        if (data["externalLink"]) console.log(chalk.dim(String(data["externalLink"])));
        const history = data["history"] as Array<Record<string, unknown>> | undefined;
        if (history && history.length > 0) {
          console.log("");
          console.log(chalk.bold("History:"));
          for (const ev of history) {
            const ts = ev["updated_at"] ?? ev["occurredAt"] ?? "-";
            console.log(`  ${chalk.dim(String(ts))}  ${ev["status"] ?? "-"}  ${ev["note"] ?? ""}`);
          }
        }
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

export { shipping };

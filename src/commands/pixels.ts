import { Command } from "commander";
import chalk from "chalk";
import { apiRequest } from "../lib/api.js";
import { output } from "../lib/output.js";

/**
 * `sell pixels` — merchant-side conversion-tracking config. Matches the
 * dashboard page at /dashboard/marketing/pixels. Partial PATCH semantics:
 * only flags you pass get sent in the body, so `sell pixels set --meta X`
 * leaves Google + TikTok fields untouched.
 */

export const pixels = new Command("pixels").description("Configure Meta / Google / TikTok conversion tracking pixels");

interface PixelsRow {
  metaPixelId: string | null;
  metaCapiAccessToken: string | null;
  metaTestEventCode: string | null;
  googleAnalyticsId: string | null;
  googleAdsConversionId: string | null;
  googleAdsPurchaseLabel: string | null;
  tiktokPixelId: string | null;
  enabled: boolean;
}

function handleError(err: unknown, json?: boolean): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (json) {
    output({ error: { message: msg } }, { json: true });
  } else {
    console.error(chalk.red(`Error: ${msg}`));
  }
  process.exit(1);
}

function render(row: PixelsRow): void {
  const mask = (s: string | null) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : chalk.dim("(not set)"));
  const show = (s: string | null) => (s ? s : chalk.dim("(not set)"));
  console.log(`Meta Pixel ID:       ${show(row.metaPixelId)}`);
  console.log(`Meta CAPI token:     ${mask(row.metaCapiAccessToken)}`);
  console.log(`Meta test event:     ${show(row.metaTestEventCode)}`);
  console.log(`GA4 measurement ID:  ${show(row.googleAnalyticsId)}`);
  console.log(`Google Ads ID:       ${show(row.googleAdsConversionId)}`);
  console.log(`Google Ads label:    ${show(row.googleAdsPurchaseLabel)}`);
  console.log(`TikTok Pixel ID:     ${show(row.tiktokPixelId)}`);
  console.log(`Enabled:             ${row.enabled ? chalk.green("yes") : chalk.red("no")}`);
}

pixels
  .command("get")
  .description("Show the current pixel configuration")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<PixelsRow>("/account/pixels", { sandbox: g.sandbox });
      const data = (result as unknown as { data?: PixelsRow }).data ?? (result as unknown as PixelsRow);
      if (g.json) output(result, { json: true });
      else render(data);
    } catch (err) { handleError(err, g.json); }
  });

pixels
  .command("set")
  .description("Update pixel IDs (only supplied fields change)")
  .option("--meta <id>", "Meta Pixel ID")
  .option("--meta-capi-token <token>", "Meta Conversions API access token")
  .option("--meta-test-event <code>", "Meta CAPI test event code")
  .option("--google-analytics <id>", "Google Analytics 4 measurement ID (G-XXX)")
  .option("--google-ads <id>", "Google Ads conversion ID (AW-XXX)")
  .option("--google-ads-label <label>", "Google Ads purchase conversion label")
  .option("--tiktok <id>", "TikTok Pixel ID")
  .option("--enable", "Enable all pixel tracking")
  .option("--disable", "Disable all pixel tracking without clearing IDs")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.meta !== undefined) body.metaPixelId = opts.meta;
      if (opts.metaCapiToken !== undefined) body.metaCapiAccessToken = opts.metaCapiToken;
      if (opts.metaTestEvent !== undefined) body.metaTestEventCode = opts.metaTestEvent;
      if (opts.googleAnalytics !== undefined) body.googleAnalyticsId = opts.googleAnalytics;
      if (opts.googleAds !== undefined) body.googleAdsConversionId = opts.googleAds;
      if (opts.googleAdsLabel !== undefined) body.googleAdsPurchaseLabel = opts.googleAdsLabel;
      if (opts.tiktok !== undefined) body.tiktokPixelId = opts.tiktok;
      if (opts.enable) body.enabled = true;
      if (opts.disable) body.enabled = false;

      if (Object.keys(body).length === 0) {
        console.error(chalk.yellow("No changes supplied. Pass at least one --meta/--google-analytics/--tiktok/… flag."));
        process.exit(1);
      }

      const result = await apiRequest<PixelsRow>("/account/pixels", {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });
      const data = (result as unknown as { data?: PixelsRow }).data ?? (result as unknown as PixelsRow);
      if (g.json) output(result, { json: true });
      else {
        console.log(chalk.green("Pixels updated."));
        render(data);
      }
    } catch (err) { handleError(err, g.json); }
  });

pixels
  .command("clear")
  .description("Nullify one platform's fields (leaves the others intact)")
  .requiredOption("--platform <platform>", "meta | google | tiktok")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      switch (opts.platform) {
        case "meta":
          body.metaPixelId = null;
          body.metaCapiAccessToken = null;
          body.metaTestEventCode = null;
          break;
        case "google":
          body.googleAnalyticsId = null;
          body.googleAdsConversionId = null;
          body.googleAdsPurchaseLabel = null;
          break;
        case "tiktok":
          body.tiktokPixelId = null;
          break;
        default:
          console.error(chalk.red(`Unknown platform: ${opts.platform}. Expected meta | google | tiktok.`));
          process.exit(1);
      }
      const result = await apiRequest<PixelsRow>("/account/pixels", {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) output(result, { json: true });
      else console.log(chalk.green(`Cleared ${opts.platform} fields.`));
    } catch (err) { handleError(err, g.json); }
  });

pixels
  .command("test")
  .description("Fire a test CAPI Purchase against an existing session (Meta Events Manager → Test Events)")
  .requiredOption("--platform <platform>", "Currently only `meta` is supported")
  .requiredOption("--session <id>", "A checkout session ID in your account to use as the test payload")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    if (opts.platform !== "meta") {
      console.error(chalk.yellow("Test events are currently Meta-only."));
      process.exit(1);
    }
    try {
      const result = await apiRequest<{ sent: boolean; reason?: string }>("/account/pixels/test-capi", {
        method: "POST",
        body: { sessionId: opts.session },
        sandbox: g.sandbox,
      });
      const data = (result as unknown as { data?: { sent: boolean; reason?: string } }).data
        ?? (result as unknown as { sent: boolean; reason?: string });
      if (g.json) output(result, { json: true });
      else if (data.sent) console.log(chalk.green("Test Purchase delivered. Check Meta Events Manager → Test Events."));
      else console.log(chalk.yellow(`Not sent: ${data.reason ?? "unknown"}`));
    } catch (err) { handleError(err, g.json); }
  });

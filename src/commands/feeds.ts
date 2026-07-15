import { Command } from "commander";
import chalk from "chalk";
import { apiRequest } from "../lib/api.js";
import { output } from "../lib/output.js";

/**
 * `sell feeds` — product-feed config + inspection.
 * Public commands (urls, inspect) hit the storefront origin; config
 * commands hit the authed account API.
 */

export const feeds = new Command("feeds").description(
  "Configure + inspect product-catalog feeds (Google Shopping / Meta / TikTok)",
);

interface FeedConfig {
  enabled: boolean;
  defaultGoogleProductCategory: string | null;
  includeUnpublished: boolean;
  urls: { google: string; meta: string; tiktok: string };
}

function defaultBase(): string {
  return process.env.STORLAUNCH_PUBLIC_URL ?? "https://storlaunch.forjio.com";
}

function handleError(err: unknown, json?: boolean): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (json) output({ error: { message: msg } }, { json: true });
  else console.error(chalk.red(`Error: ${msg}`));
  process.exit(1);
}

feeds
  .command("urls")
  .description("Print the three feed URLs for a merchant — paste into Google/Meta/TikTok dashboards")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--base-url <url>", "Override the storefront base URL")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean }>();
    const base = (opts.baseUrl ?? defaultBase()).replace(/\/$/, "");
    const slug = encodeURIComponent(opts.merchant);
    const urls = {
      google: `${base}/api/v1/storefront/public/${slug}/feeds/google.xml`,
      meta: `${base}/api/v1/storefront/public/${slug}/feeds/meta.xml`,
      tiktok: `${base}/api/v1/storefront/public/${slug}/feeds/tiktok.xml`,
    };
    if (g.json) output(urls, { json: true });
    else {
      console.log(chalk.bold("Google Shopping:") + " " + urls.google);
      console.log(chalk.bold("Meta Catalog:   ") + " " + urls.meta);
      console.log(chalk.bold("TikTok Catalog: ") + " " + urls.tiktok);
    }
  });

feeds
  .command("inspect")
  .description("Fetch a merchant's feed and report item count + missing-field warnings")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--format <format>", "google | meta | tiktok", "google")
  .option("--base-url <url>", "Override the storefront base URL")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean }>();
    const base = (opts.baseUrl ?? defaultBase()).replace(/\/$/, "");
    const url = `${base}/api/v1/storefront/public/${encodeURIComponent(opts.merchant)}/feeds/${opts.format}.xml`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(chalk.red(`Failed: ${res.status} ${res.statusText} ← ${url}`));
        process.exit(1);
      }
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>/g)].length;
      const missingGtin = items - [...xml.matchAll(/<g:gtin>/g)].length;
      const missingImage = items - [...xml.matchAll(/<g:image_link>/g)].length;
      const zeroPrice = [...xml.matchAll(/<g:price>0(?:\.0+)? /g)].length;
      const summary = { url, format: opts.format, items, missingGtin, missingImage, zeroPrice };
      if (g.json) output(summary, { json: true });
      else {
        console.log(chalk.dim(url));
        console.log(`${chalk.bold(items)} items`);
        if (missingGtin > 0) console.log(chalk.yellow(`⚠  ${missingGtin} items without g:gtin (Google identifier_exists=no will be set)`));
        if (missingImage > 0) console.log(chalk.red(`✗  ${missingImage} items without g:image_link (will be rejected by Google Shopping)`));
        if (zeroPrice > 0) console.log(chalk.red(`✗  ${zeroPrice} items with zero price`));
        if (missingGtin === 0 && missingImage === 0 && zeroPrice === 0) console.log(chalk.green("All checks passed"));
      }
    } catch (err) { handleError(err, g.json); }
  });

const config = new Command("config").description("Get / update merchant feed config");

config
  .command("get")
  .description("Show the merchant's feed config + computed URLs")
  .action(async (_opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<FeedConfig>("/account/feeds", { sandbox: g.sandbox });
      const data = (result as unknown as { data?: FeedConfig }).data ?? (result as unknown as FeedConfig);
      if (g.json) output(result, { json: true });
      else {
        console.log(`Enabled:          ${data.enabled ? chalk.green("yes") : chalk.red("no")}`);
        console.log(`Default category: ${data.defaultGoogleProductCategory ?? chalk.dim("(none)")}`);
        console.log(`Include drafts:   ${data.includeUnpublished ? chalk.yellow("yes") : "no"}`);
        console.log("");
        console.log(chalk.bold("Feed URLs (submit these to ad-network dashboards):"));
        console.log(`  Google: ${data.urls.google}`);
        console.log(`  Meta:   ${data.urls.meta}`);
        console.log(`  TikTok: ${data.urls.tiktok}`);
      }
    } catch (err) { handleError(err, g.json); }
  });

config
  .command("set")
  .description("Update fields (only flags you pass are changed)")
  .option("--enable", "Enable feeds")
  .option("--disable", "Disable feeds (returns 404 from public endpoints)")
  .option("--default-category <text>", "Default Google product category (path or taxonomy ID)")
  .option("--include-unpublished", "Include draft products")
  .option("--no-include-unpublished", "Exclude draft products")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body: Record<string, unknown> = {};
      if (opts.enable) body.enabled = true;
      if (opts.disable) body.enabled = false;
      if (opts.defaultCategory !== undefined) body.defaultGoogleProductCategory = opts.defaultCategory;
      // Commander turns --include-unpublished into true and --no-include-unpublished into false.
      if (opts.includeUnpublished === true) body.includeUnpublished = true;
      else if (opts.includeUnpublished === false) body.includeUnpublished = false;

      if (Object.keys(body).length === 0) {
        console.error(chalk.yellow("No changes supplied."));
        process.exit(1);
      }
      const result = await apiRequest<FeedConfig>("/account/feeds", {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) output(result, { json: true });
      else console.log(chalk.green("Config saved."));
    } catch (err) { handleError(err, g.json); }
  });

feeds.addCommand(config);

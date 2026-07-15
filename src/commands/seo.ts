import { Command } from "commander";
import chalk from "chalk";
import { output } from "../lib/output.js";

/**
 * `sell seo` — inspect a merchant's storefront SEO on the public web.
 *
 * These commands are unauthenticated — they hit the live storefront HTML
 * directly (default https://storlaunch.forjio.com, override with
 * --base-url) and grep for the expected SEO artifacts. Useful after a
 * product launch or when debugging why Google isn't picking up a listing.
 */

export const seo = new Command("seo").description("Inspect storefront SEO (title, metadata, JSON-LD, sitemap)");

function defaultBase(): string {
  return process.env.STORLAUNCH_PUBLIC_URL ?? "https://storlaunch.forjio.com";
}

interface InspectOpts { merchant: string; baseUrl?: string }

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ← ${url}`);
  return res.text();
}

function extractJsonLdWithSource(html: string): { blobs: string[]; source: "html" | "flight" | "none" } {
  const blobs = extractJsonLd(html);
  if (blobs.length === 0) return { blobs: [], source: "none" };
  // Heuristic: if the raw HTML has a visible <script type="application/ld+json">
  // tag, we're serving real HTML. Otherwise it's RSC flight.
  const source = /<script type="application\/ld\+json">/.test(html) ? "html" : "flight";
  return { blobs, source };
}

function extractJsonLd(html: string): string[] {
  const out: string[] = [];
  // 1. Regular <script type="application/ld+json">...</script> tags (ideal).
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1].replace(/\\u003c/g, "<").replace(/\\u2028/g, "\u2028").replace(/\\u2029/g, "\u2029"));
  }
  if (out.length > 0) return out;
  // 2. Fallback: React Server Component flight payload. Next 15 streams server
  // component output inside <script>self.__next_f.push([1, "..."])</script>.
  // Decode each flight string and look for the JSON-LD <script> element shape
  // inside.
  const pushRe = /self\.__next_f\.push\(\[\s*\d+\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]\)/g;
  while ((m = pushRe.exec(html)) !== null) {
    let payload: string;
    try {
      payload = JSON.parse(`"${m[1]}"`) as string;
    } catch {
      continue;
    }
    // Inside the decoded flight, JSON-LD scripts look like:
    // "type":"application/ld+json","dangerouslySetInnerHTML":{"__html":"<escaped JSON>"}
    const innerRe = /"type":"application\/ld\+json","dangerouslySetInnerHTML":\{"__html":"((?:[^"\\]|\\.)*)"\}/g;
    let inner: RegExpExecArray | null;
    while ((inner = innerRe.exec(payload)) !== null) {
      try {
        const obj = JSON.parse(`"${inner[1]}"`) as string;
        out.push(obj.replace(/\\u003c/g, "<").replace(/\\u2028/g, "\u2028").replace(/\\u2029/g, "\u2029"));
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function pickH1FromFlight(html: string): string | null {
  // Decode each __next_f flight string and look for ["$","h1",...].
  const pushRe = /self\.__next_f\.push\(\[\s*\d+\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = pushRe.exec(html)) !== null) {
    let payload: string;
    try {
      payload = JSON.parse(`"${m[1]}"`) as string;
    } catch {
      continue;
    }
    const inner = payload.match(/"\$","h1",[^{]*\{[^}]*?"children":"((?:[^"\\]|\\.)*)"/);
    if (inner) {
      try {
        return JSON.parse(`"${inner[1]}"`) as string;
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

function pickMeta(html: string, attr: "name" | "property", value: string): string | null {
  const re = new RegExp(`<meta\\s+${attr}=["']${value}["']\\s+content=["']([^"']*)["']`, "i");
  const m = html.match(re);
  return m ? m[1] : null;
}

function pickCanonical(html: string): string | null {
  const m = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i);
  return m ? m[1] : null;
}

function pickH1(html: string): string | null {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : null;
}

function pickTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : null;
}

seo
  .command("inspect")
  .description("Check a merchant storefront for title, description, OG tags, and JSON-LD")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--base-url <url>", "Override the storefront base URL")
  .action(async (opts: InspectOpts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean }>();
    const base = opts.baseUrl ?? defaultBase();
    const url = `${base}/s/${encodeURIComponent(opts.merchant)}`;

    try {
      const html = await fetchText(url);
      const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
      const title = pickTitle(html);
      checks.push({ name: "<title>", ok: !!title, detail: title ?? "missing" });
      const desc = pickMeta(html, "name", "description");
      checks.push({ name: 'meta description', ok: !!desc, detail: desc ?? "missing" });
      const ogTitle = pickMeta(html, "property", "og:title");
      checks.push({ name: "og:title", ok: !!ogTitle, detail: ogTitle ?? "missing" });
      const ogImage = pickMeta(html, "property", "og:image");
      checks.push({ name: "og:image", ok: !!ogImage, detail: ogImage ?? "missing" });
      const twitter = pickMeta(html, "name", "twitter:card");
      checks.push({ name: "twitter:card", ok: !!twitter, detail: twitter ?? "missing" });
      const canonical = pickCanonical(html);
      checks.push({ name: "canonical", ok: !!canonical, detail: canonical ?? "missing" });
      const h1 = pickH1(html) ?? pickH1FromFlight(html);
      checks.push({ name: "<h1>", ok: !!h1, detail: h1 ?? "missing" });
      const { blobs: ldBlobs, source: ldSource } = extractJsonLdWithSource(html);
      const ldTypes = ldBlobs
        .map((b) => { try { return (JSON.parse(b) as { "@type"?: string })["@type"] ?? "?"; } catch { return "invalid-json"; } });
      checks.push({
        name: "JSON-LD",
        ok: ldBlobs.length > 0 && !ldTypes.includes("invalid-json"),
        detail: ldBlobs.length === 0
          ? "no <script type=\"application/ld+json\"> blocks found"
          : `${ldTypes.join(", ")}${ldSource === "flight" ? " (served via RSC flight — Google renders it, non-JS crawlers may miss it)" : ""}`,
      });

      const failed = checks.filter((c) => !c.ok);
      if (g.json) {
        output({ url, checks, passed: checks.length - failed.length, failed: failed.length }, { json: true });
      } else {
        console.log(chalk.dim(url));
        for (const c of checks) {
          const mark = c.ok ? chalk.green("✓") : chalk.red("✗");
          console.log(`${mark} ${c.name}: ${chalk.dim(c.detail.slice(0, 120))}`);
        }
        if (failed.length > 0) {
          console.log();
          console.log(chalk.red(`${failed.length} check${failed.length === 1 ? "" : "s"} failed`));
        } else {
          console.log();
          console.log(chalk.green("All checks passed"));
        }
      }
      if (failed.length > 0) process.exit(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (g.json) output({ error: { message: msg } }, { json: true });
      else console.error(chalk.red(`Failed: ${msg}`));
      process.exit(1);
    }
  });

seo
  .command("sitemap")
  .description("Summarize a merchant sitemap: product count, oldest/newest entries")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .option("--base-url <url>", "Override the storefront base URL")
  .action(async (opts: InspectOpts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean }>();
    const base = opts.baseUrl ?? defaultBase();
    const url = `${base}/s/${encodeURIComponent(opts.merchant)}/sitemap.xml`;
    try {
      const xml = await fetchText(url);
      // Lightweight parse — we don't need a full XML parser for
      // <lastmod>...</lastmod> + <loc>...</loc> extraction.
      const urls = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
      const modifieds = [...xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)]
        .map((m) => m[1])
        .filter((s) => !Number.isNaN(new Date(s).getTime()));
      const sorted = [...modifieds].sort();

      const result = {
        url,
        urlCount: urls.length,
        oldest: sorted[0] ?? null,
        newest: sorted[sorted.length - 1] ?? null,
      };
      if (g.json) output(result, { json: true });
      else {
        console.log(chalk.dim(url));
        console.log(`${chalk.bold(result.urlCount)} URLs`);
        console.log(`Oldest: ${chalk.dim(result.oldest ?? "(none)")}`);
        console.log(`Newest: ${chalk.dim(result.newest ?? "(none)")}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (g.json) output({ error: { message: msg } }, { json: true });
      else console.error(chalk.red(`Failed: ${msg}`));
      process.exit(1);
    }
  });

interface ProductSchemaOpts { merchant: string; product: string; baseUrl?: string }

seo
  .command("product-schema")
  .description("Extract and pretty-print the Product JSON-LD from a product page")
  .requiredOption("--merchant <slug>", "Merchant slug")
  .requiredOption("--product <slug>", "Product slug")
  .option("--base-url <url>", "Override the storefront base URL")
  .action(async (opts: ProductSchemaOpts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean }>();
    const base = opts.baseUrl ?? defaultBase();
    const url = `${base}/s/${encodeURIComponent(opts.merchant)}/${encodeURIComponent(opts.product)}`;
    try {
      const html = await fetchText(url);
      const blobs = extractJsonLd(html);
      const parsed = blobs
        .map((b) => { try { return JSON.parse(b) as Record<string, unknown>; } catch { return null; } })
        .filter((p): p is Record<string, unknown> => p !== null);
      const product = parsed.find((p) => p["@type"] === "Product");
      if (!product) {
        if (g.json) output({ error: { message: "No Product JSON-LD found" } }, { json: true });
        else console.error(chalk.red("No Product JSON-LD found on page"));
        process.exit(1);
        return;
      }
      if (g.json) output(product, { json: true });
      else console.log(JSON.stringify(product, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (g.json) output({ error: { message: msg } }, { json: true });
      else console.error(chalk.red(`Failed: ${msg}`));
      process.exit(1);
    }
  });

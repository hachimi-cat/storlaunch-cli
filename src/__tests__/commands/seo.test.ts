import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { seo } from "../../commands/seo.js";

function createProgram() {
  const program = new Command();
  program.option("--json");
  program.addCommand(seo);
  program.exitOverride();
  return program;
}

function htmlFixture(overrides: Partial<{ title: string; description: string; ogImage: string; twitterCard: string; canonical: string; h1: string; ld: string[] }> = {}): string {
  const pieces = [
    `<title>${overrides.title ?? "Acme Shop"}</title>`,
    `<meta name="description" content="${overrides.description ?? "Default desc"}">`,
    `<meta property="og:title" content="${overrides.title ?? "Acme Shop"}">`,
    `<meta property="og:image" content="${overrides.ogImage ?? "https://example.com/og.png"}">`,
    `<meta name="twitter:card" content="${overrides.twitterCard ?? "summary_large_image"}">`,
    `<link rel="canonical" href="${overrides.canonical ?? "https://example.com/s/acme"}">`,
    `<h1>${overrides.h1 ?? "Acme Shop"}</h1>`,
    ...(overrides.ld ?? [`{"@type":"Organization","name":"Acme Shop"}`]).map(
      (b) => `<script type="application/ld+json">${b}</script>`,
    ),
  ];
  return `<html><head>${pieces.slice(0, 7).join("\n")}</head><body>${pieces.slice(6).join("\n")}</body></html>`;
}

describe("sell seo inspect", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    fetchSpy?.mockRestore();
  });

  it("passes every check on well-formed storefront HTML", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(htmlFixture(), { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node", "cli", "seo", "inspect",
      "--merchant", "acme",
      "--base-url", "https://example.com",
    ]);
    // At least one ✓ line per check (title, description, og:title, og:image,
    // twitter:card, canonical, h1, JSON-LD)
    const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("All checks passed");
    // No process.exit(1) — success path
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("fails when og:image is missing", async () => {
    // Remove og:image by overriding with empty string and stripping the line manually.
    const html = htmlFixture().replace(
      /<meta property="og:image"[^>]*>\n?/,
      "",
    );
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    const program = createProgram();
    await expect(program.parseAsync([
      "node", "cli", "seo", "inspect",
      "--merchant", "acme",
      "--base-url", "https://example.com",
    ])).rejects.toThrow(/process\.exit\(1\)/);
    const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stdout).toContain("og:image");
    expect(stdout).toContain("missing");
  });

  it("fails when the page returns 404", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );
    const program = createProgram();
    await expect(program.parseAsync([
      "node", "cli", "seo", "inspect",
      "--merchant", "ghost",
      "--base-url", "https://example.com",
    ])).rejects.toThrow(/process\.exit\(1\)/);
    const err = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(err).toMatch(/404/);
  });

  it("emits structured JSON when --json is passed", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(htmlFixture(), { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node", "cli", "--json", "seo", "inspect",
      "--merchant", "acme",
      "--base-url", "https://example.com",
    ]);
    const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(stdout);
    expect(parsed.url).toBe("https://example.com/s/acme");
    expect(parsed.checks).toEqual(expect.any(Array));
    expect(parsed.passed).toBeGreaterThan(0);
  });
});

describe("sell seo sitemap", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    exitSpy.mockRestore();
    fetchSpy?.mockRestore();
  });

  it("counts URLs and finds oldest/newest lastmod", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://example.com/s/acme</loc><lastmod>2026-01-01</lastmod></url>
  <url><loc>https://example.com/s/acme/a</loc><lastmod>2026-03-10</lastmod></url>
  <url><loc>https://example.com/s/acme/b</loc><lastmod>2026-02-01</lastmod></url>
</urlset>`;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(xml, { status: 200 }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node", "cli", "--json", "seo", "sitemap",
      "--merchant", "acme",
      "--base-url", "https://example.com",
    ]);
    const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(stdout);
    expect(parsed.urlCount).toBe(3);
    expect(parsed.oldest).toBe("2026-01-01");
    expect(parsed.newest).toBe("2026-03-10");
  });
});

describe("sell seo product-schema", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    fetchSpy?.mockRestore();
  });

  it("extracts and pretty-prints the Product JSON-LD", async () => {
    const product = { "@type": "Product", name: "Widget", offers: { price: "250000" } };
    const html = htmlFixture({ ld: [
      JSON.stringify({ "@type": "Organization", name: "Acme" }),
      JSON.stringify(product),
    ] });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    const program = createProgram();
    await program.parseAsync([
      "node", "cli", "--json", "seo", "product-schema",
      "--merchant", "acme",
      "--product", "widget",
      "--base-url", "https://example.com",
    ]);
    const stdout = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const parsed = JSON.parse(stdout);
    expect(parsed["@type"]).toBe("Product");
    expect(parsed.name).toBe("Widget");
  });

  it("fails with non-zero exit if the page has no Product JSON-LD", async () => {
    const html = htmlFixture({ ld: [JSON.stringify({ "@type": "Organization" })] });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    const program = createProgram();
    await expect(program.parseAsync([
      "node", "cli", "seo", "product-schema",
      "--merchant", "acme",
      "--product", "widget",
      "--base-url", "https://example.com",
    ])).rejects.toThrow(/process\.exit\(1\)/);
  });
});

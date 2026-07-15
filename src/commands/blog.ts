import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { apiRequest } from "../lib/api.js";
import { output } from "../lib/output.js";

/**
 * `sell blog` — manage blog posts on the merchant storefront content hub.
 * Mirrors /dashboard/marketing/blog. Useful for CI pipelines publishing
 * from a repo of markdown files.
 */

export const blog = new Command("blog").description("Manage blog posts (Phase F.4)");

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published";
  publishedAt: string | null;
  authorName: string | null;
  tags: string[];
  excerpt: string | null;
  body?: string;
  createdAt: string;
  updatedAt: string;
}

function handleError(err: unknown, json?: boolean): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (json) output({ error: { message: msg } }, { json: true });
  else console.error(chalk.red(`Error: ${msg}`));
  process.exit(1);
}

function unwrap<T>(result: unknown): T {
  return ((result as { data?: T }).data ?? (result as T)) as T;
}

function loadBody(opts: { body?: string; bodyFile?: string }): string | undefined {
  if (opts.body) return opts.body;
  if (opts.bodyFile) return readFileSync(opts.bodyFile, "utf8");
  return undefined;
}

function parseTags(raw?: string): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

// ─── list ─────────────────────────────────────────────────────────────────

blog
  .command("list")
  .description("List blog posts (newest first)")
  .option("--status <status>", "Filter by status: draft | published")
  .option("--limit <n>", "Max results", "50")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const params = new URLSearchParams();
      if (opts.status) params.set("status", opts.status);
      if (opts.limit) params.set("limit", String(opts.limit));
      const result = await apiRequest<BlogPost[]>(`/account/blog/posts?${params}`, { sandbox: g.sandbox });
      const posts = unwrap<BlogPost[]>(result);
      if (g.json) output(result, { json: true });
      else if (posts.length === 0) console.log(chalk.dim("No posts."));
      else {
        for (const p of posts) {
          const s = p.status === "published" ? chalk.green("●") : chalk.dim("○");
          console.log(`${s} ${chalk.bold(p.title)}  ${chalk.dim(p.id)}`);
          console.log(`  /${p.slug}   ${p.tags.length ? chalk.dim(p.tags.map((t) => `#${t}`).join(" ")) : ""}`);
        }
      }
    } catch (err) { handleError(err, g.json); }
  });

blog
  .command("get <id>")
  .description("Show a single post with full body")
  .action(async (id, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<BlogPost>(`/account/blog/posts/${encodeURIComponent(id)}`, { sandbox: g.sandbox });
      if (g.json) output(result, { json: true });
      else {
        const p = unwrap<BlogPost>(result);
        console.log(chalk.bold(p.title));
        console.log(chalk.dim(`  id:      ${p.id}`));
        console.log(chalk.dim(`  slug:    ${p.slug}`));
        console.log(chalk.dim(`  status:  ${p.status}`));
        if (p.publishedAt) console.log(chalk.dim(`  published: ${p.publishedAt}`));
        if (p.authorName) console.log(chalk.dim(`  author:  ${p.authorName}`));
        if (p.tags.length) console.log(chalk.dim(`  tags:    ${p.tags.join(", ")}`));
        if (p.excerpt) console.log(`\n${p.excerpt}`);
        if (p.body) console.log(`\n${chalk.dim("─".repeat(40))}\n${p.body}\n`);
      }
    } catch (err) { handleError(err, g.json); }
  });

// ─── create ───────────────────────────────────────────────────────────────

blog
  .command("create")
  .description("Create a new post (draft by default)")
  .requiredOption("--title <title>", "Post title")
  .option("--slug <slug>", "Slug (auto-generated from title if omitted)")
  .option("--body <markdown>", "Post body (Markdown)")
  .option("--body-file <path>", "Read body from a file")
  .option("--excerpt <text>", "Short excerpt shown in list + OG tags")
  .option("--cover-image <url>", "Cover image URL")
  .option("--author <name>", "Author display name")
  .option("--tags <csv>", "Comma-separated tags")
  .option("--meta-title <text>", "SEO meta title (falls back to title)")
  .option("--meta-description <text>", "SEO meta description (falls back to excerpt)")
  .option("--publish", "Create as published instead of draft")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body = loadBody(opts);
      if (!body) { console.error(chalk.red("--body or --body-file is required")); process.exit(1); }
      const payload: Record<string, unknown> = {
        title: opts.title,
        body,
        ...(opts.slug ? { slug: opts.slug } : {}),
        ...(opts.excerpt ? { excerpt: opts.excerpt } : {}),
        ...(opts.coverImage ? { coverImage: opts.coverImage } : {}),
        ...(opts.author ? { authorName: opts.author } : {}),
        ...(opts.metaTitle ? { metaTitle: opts.metaTitle } : {}),
        ...(opts.metaDescription ? { metaDescription: opts.metaDescription } : {}),
        ...(parseTags(opts.tags) ? { tags: parseTags(opts.tags) } : {}),
        ...(opts.publish ? { status: "published" } : {}),
      };
      const result = await apiRequest<BlogPost>("/account/blog/posts", {
        method: "POST",
        body: payload,
        sandbox: g.sandbox,
      });
      if (g.json) output(result, { json: true });
      else {
        const p = unwrap<BlogPost>(result);
        console.log(chalk.green(`Created ${p.status === "published" ? "and published" : "draft"}: ${p.title}`));
        console.log(chalk.dim(`  id: ${p.id}`));
        console.log(chalk.dim(`  slug: /${p.slug}`));
      }
    } catch (err) { handleError(err, g.json); }
  });

// ─── update ───────────────────────────────────────────────────────────────

blog
  .command("update <id>")
  .description("Update fields (only flags you pass are changed)")
  .option("--title <title>")
  .option("--slug <slug>")
  .option("--body <markdown>")
  .option("--body-file <path>")
  .option("--excerpt <text>")
  .option("--cover-image <url>")
  .option("--author <name>")
  .option("--tags <csv>")
  .option("--meta-title <text>")
  .option("--meta-description <text>")
  .action(async (id, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const body = loadBody(opts);
      const payload: Record<string, unknown> = {
        ...(opts.title ? { title: opts.title } : {}),
        ...(opts.slug ? { slug: opts.slug } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(opts.excerpt ? { excerpt: opts.excerpt } : {}),
        ...(opts.coverImage ? { coverImage: opts.coverImage } : {}),
        ...(opts.author ? { authorName: opts.author } : {}),
        ...(opts.metaTitle ? { metaTitle: opts.metaTitle } : {}),
        ...(opts.metaDescription ? { metaDescription: opts.metaDescription } : {}),
        ...(parseTags(opts.tags) ? { tags: parseTags(opts.tags) } : {}),
      };
      if (Object.keys(payload).length === 0) {
        console.error(chalk.yellow("No changes supplied."));
        process.exit(1);
      }
      const result = await apiRequest<BlogPost>(`/account/blog/posts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: payload,
        sandbox: g.sandbox,
      });
      if (g.json) output(result, { json: true });
      else console.log(chalk.green("Post updated."));
    } catch (err) { handleError(err, g.json); }
  });

// ─── publish / unpublish / delete ─────────────────────────────────────────

blog
  .command("publish <id>")
  .description("Publish a draft post (stamps publishedAt to now if unset)")
  .action(async (id, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<BlogPost>(`/account/blog/posts/${encodeURIComponent(id)}/publish`, {
        method: "POST",
        sandbox: g.sandbox,
      });
      if (g.json) output(result, { json: true });
      else console.log(chalk.green("Published."));
    } catch (err) { handleError(err, g.json); }
  });

blog
  .command("unpublish <id>")
  .description("Flip a published post back to draft (publishedAt history preserved)")
  .action(async (id, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<BlogPost>(`/account/blog/posts/${encodeURIComponent(id)}/unpublish`, {
        method: "POST",
        sandbox: g.sandbox,
      });
      if (g.json) output(result, { json: true });
      else console.log(chalk.yellow("Unpublished (post is now a draft)."));
    } catch (err) { handleError(err, g.json); }
  });

blog
  .command("delete <id>")
  .description("Permanently delete a post")
  .action(async (id, _opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      await apiRequest(`/account/blog/posts/${encodeURIComponent(id)}`, {
        method: "DELETE",
        sandbox: g.sandbox,
      });
      if (g.json) output({ deleted: true }, { json: true });
      else console.log(chalk.red("Deleted."));
    } catch (err) { handleError(err, g.json); }
  });

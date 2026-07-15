import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { apiRequest, ApiClientError } from "../lib/api.js";
import { output, type Column } from "../lib/output.js";

/**
 * `sell workspace` — merchant workspace management. Backend mount is
 * app-level at `/api/v1/workspaces` (see backend/src/index.ts line 51).
 *
 * Real endpoints:
 *   GET    /workspaces/current                       — show active workspace
 *   PATCH  /workspaces/current                       — rename active workspace
 *   GET    /workspaces                               — list workspaces user belongs to
 *   POST   /workspaces                               — create workspace
 *   GET    /workspaces/current/members               — list members
 *   POST   /workspaces/current/members               — invite by email
 *   DELETE /workspaces/current/members/:userId       — remove
 *   PATCH  /workspaces/current/members/:userId       — change role
 *
 * The audit hinted at `/workspace` (singular) and `/workspace/members`
 * — those don't exist. Only the plural-current shape is on the backend.
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
    console.error(
      JSON.stringify({ data: null, error: { code: err.code, message: err.message } }, null, 2)
    );
  } else {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
  }
  process.exit(getExitCode(err));
}

function parseBody(raw: string | undefined, fileRaw: string | undefined): Record<string, unknown> {
  let source: string | undefined;
  if (fileRaw) {
    try {
      source = readFileSync(fileRaw, "utf-8");
    } catch (e) {
      console.error(chalk.red(`Error: cannot read --body-file ${fileRaw}: ${(e as Error).message}`));
      process.exit(1);
    }
  } else if (raw) {
    source = raw;
  } else {
    console.error(chalk.red("Error: --body <json> or --body-file <path> is required"));
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(chalk.red("Error: body must be a JSON object"));
      process.exit(1);
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    console.error(chalk.red(`Error: --body is not valid JSON: ${(e as Error).message}`));
    process.exit(1);
  }
}

function unwrap<T = unknown>(result: unknown): T {
  if (result && typeof result === "object" && "data" in (result as Record<string, unknown>)) {
    return (result as { data: T }).data;
  }
  return result as T;
}

const workspace = new Command("workspace").description(
  "Workspace + member management (active workspace from auth session)"
);

workspace
  .command("show")
  .description("Show the active workspace (id, name, slug, plan, role)")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/workspaces/current", {
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        const data = unwrap<Record<string, unknown>>(result);
        output(data, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

workspace
  .command("update")
  .description("Rename the active workspace (PATCH /workspaces/current)")
  .option("--body <json>", "JSON object — currently only { name } is supported")
  .option("--body-file <path>", "Read JSON body from a file")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    const body = parseBody(opts.body, opts.bodyFile);
    try {
      const result = await apiRequest<Record<string, unknown>>("/workspaces/current", {
        method: "PATCH",
        body,
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green("Workspace updated."));
        const data = unwrap<Record<string, unknown>>(result);
        output(data, {});
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

workspace
  .command("list")
  .description("List workspaces this user belongs to")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>("/workspaces", {
        sandbox: g.sandbox,
      });
      if (g.json) {
        output(result, { json: true });
      } else {
        const data = unwrap<Record<string, unknown>[]>(result) ?? [];
        const cols: Column[] = [
          { key: "id", header: "ID", width: 24 },
          { key: "name", header: "Name", width: 24 },
          { key: "slug", header: "Slug", width: 24 },
          { key: "plan", header: "Plan", width: 10 },
          { key: "role", header: "Role" },
        ];
        output(data, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

// ─── members ────────────────────────────────────────────────────────────────

const members = new Command("members").description(
  "Manage members of the active workspace"
);

members
  .command("list")
  .description("List members of the active workspace")
  .action(async (_, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(
        "/workspaces/current/members",
        { sandbox: g.sandbox }
      );
      if (g.json) {
        output(result, { json: true });
      } else {
        const data = unwrap<Record<string, unknown>[]>(result) ?? [];
        const cols: Column[] = [
          { key: "userId", header: "User ID", width: 24 },
          { key: "email", header: "Email", width: 28 },
          { key: "name", header: "Name", width: 20 },
          { key: "role", header: "Role", width: 8 },
          { key: "joinedAt", header: "Joined" },
        ];
        output(data, { columns: cols });
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

members
  .command("add")
  .description("Invite a member by email")
  .requiredOption("--email <email>", "Email of the user to invite")
  .option("--role <role>", "Role: admin | member", "member")
  .action(async (opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(
        "/workspaces/current/members",
        {
          method: "POST",
          body: { email: opts.email, role: opts.role },
          sandbox: g.sandbox,
        }
      );
      if (g.json) {
        output(result, { json: true });
      } else {
        const data = unwrap<Record<string, unknown>>(result);
        console.log(
          chalk.green(
            `Invited ${chalk.bold(opts.email)} as ${opts.role}.${data?.userId ? ` userId=${String(data.userId)}` : ""}`
          )
        );
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

members
  .command("remove <userId>")
  .description("Remove a member from the active workspace")
  .action(async (userId: string, _, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(
        `/workspaces/current/members/${userId}`,
        { method: "DELETE", sandbox: g.sandbox }
      );
      if (g.json) {
        output(result ?? { removed: true, userId }, { json: true });
      } else {
        console.log(chalk.green(`Member ${userId} removed.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

members
  .command("set-role <userId>")
  .description("Change role of a member (admin | member)")
  .requiredOption("--role <role>", "New role: admin | member")
  .action(async (userId: string, opts, cmd: Command) => {
    const g = cmd.optsWithGlobals<{ json?: boolean; sandbox?: boolean }>();
    try {
      const result = await apiRequest<Record<string, unknown>>(
        `/workspaces/current/members/${userId}`,
        { method: "PATCH", body: { role: opts.role }, sandbox: g.sandbox }
      );
      if (g.json) {
        output(result, { json: true });
      } else {
        console.log(chalk.green(`Member ${userId} role set to ${opts.role}.`));
      }
    } catch (err) {
      handleError(err, g.json);
    }
  });

workspace.addCommand(members);

export { workspace };

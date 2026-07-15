import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
vi.mock("../../lib/api.js", () => {
  class ApiClientError extends Error {
    status: number;
    constructor(e: { status: number; message: string }) {
      super(e.message);
      this.name = "ApiClientError";
      this.status = e.status;
    }
  }
  return { apiRequest: vi.fn(), ApiClientError };
});

vi.mock("../../lib/config.js", () => ({
  resolveApiKey: vi.fn(() => "sk_live_test"),
  resolveApiUrl: vi.fn(() => "https://api.test/v1"),
}));

import { apiRequest } from "../../lib/api.js";
import { blog } from "../../commands/blog.js";

function createProgram() {
  const program = new Command();
  program.option("--json").option("--sandbox");
  program.addCommand(blog);
  program.exitOverride();
  return program;
}

describe("sell blog", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.mocked(apiRequest).mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("list hits GET /account/blog/posts", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: [{ id: "p1", slug: "hello", title: "Hello", status: "published", tags: [], excerpt: null, publishedAt: null, authorName: null, createdAt: "", updatedAt: "" }],
    } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "blog", "list"]);
    expect(apiRequest).toHaveBeenCalledWith(
      expect.stringContaining("/account/blog/posts"),
      expect.objectContaining({ sandbox: undefined }),
    );
  });

  it("list --status draft adds status query param", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: [] } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "blog", "list", "--status", "draft"]);
    const url = vi.mocked(apiRequest).mock.calls[0][0];
    expect(url).toContain("status=draft");
  });

  it("get <id> hits GET /account/blog/posts/:id", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: { id: "p1", slug: "hello", title: "Hello", status: "draft", tags: [], excerpt: null, publishedAt: null, authorName: null, body: "hi", createdAt: "", updatedAt: "" },
    } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "blog", "get", "p1"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/blog/posts/p1",
      expect.objectContaining({ sandbox: undefined }),
    );
  });

  it("create POSTs with body + tags", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      data: { id: "p2", slug: "hi-there", title: "Hi there", status: "draft", tags: ["launch"], excerpt: null, publishedAt: null, authorName: null, createdAt: "", updatedAt: "" },
    } as unknown as never);
    const p = createProgram();
    await p.parseAsync([
      "node", "cli", "blog", "create",
      "--title", "Hi there",
      "--body", "# Hi\n\nWorld",
      "--tags", "launch, update",
      "--author", "Bang Adi",
    ]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/blog/posts",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          title: "Hi there",
          body: "# Hi\n\nWorld",
          authorName: "Bang Adi",
          tags: ["launch", "update"],
        }),
      }),
    );
  });

  it("create --publish sets status=published", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync([
      "node", "cli", "blog", "create",
      "--title", "X", "--body", "y", "--publish",
    ]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/blog/posts",
      expect.objectContaining({
        body: expect.objectContaining({ status: "published" }),
      }),
    );
  });

  it("create fails without --body or --body-file", async () => {
    const p = createProgram();
    await expect(p.parseAsync([
      "node", "cli", "blog", "create", "--title", "X",
    ])).rejects.toThrow(/process\.exit/);
  });

  it("update PATCHes only provided fields", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync([
      "node", "cli", "blog", "update", "p1", "--title", "New title",
    ]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/blog/posts/p1",
      expect.objectContaining({
        method: "PATCH",
        body: { title: "New title" },
      }),
    );
  });

  it("publish POSTs /:id/publish", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "blog", "publish", "p1"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/blog/posts/p1/publish",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("unpublish POSTs /:id/unpublish", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: {} } as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "blog", "unpublish", "p1"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/blog/posts/p1/unpublish",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("delete DELETEs /:id", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({} as unknown as never);
    const p = createProgram();
    await p.parseAsync(["node", "cli", "blog", "delete", "p1"]);
    expect(apiRequest).toHaveBeenCalledWith(
      "/account/blog/posts/p1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

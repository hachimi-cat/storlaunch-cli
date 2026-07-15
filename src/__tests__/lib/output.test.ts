import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatTable, formatJson, output, type Column } from "../../lib/output.js";

describe("formatTable", () => {
  const columns: Column[] = [
    { key: "id", header: "ID", width: 10 },
    { key: "name", header: "Name" },
    { key: "status", header: "Status" },
  ];

  it("formats data rows with headers and separators", () => {
    const data = [
      { id: "plan_1", name: "Pro", status: "active" },
      { id: "plan_2", name: "Free", status: "active" },
    ];

    const result = formatTable(data, columns);
    const lines = result.split("\n");

    // Header line
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("Name");
    expect(lines[0]).toContain("Status");
    // Separator line
    expect(lines[1]).toContain("─");
    // Data rows
    expect(lines[2]).toContain("plan_1");
    expect(lines[2]).toContain("Pro");
    expect(lines[3]).toContain("plan_2");
    expect(lines[3]).toContain("Free");
  });

  it("returns 'No results.' for empty data", () => {
    const result = formatTable([], columns);
    expect(result).toContain("No results.");
  });

  it("truncates long values with ellipsis", () => {
    const data = [
      { id: "a".repeat(50), name: "Test", status: "ok" },
    ];

    const result = formatTable(data, columns);
    // ID column width is 10, so "aaaa..." should be truncated
    expect(result).toContain("…");
  });

  it("handles missing values as empty strings", () => {
    const data = [{ id: "plan_1" }];
    const result = formatTable(data, columns);
    expect(result).toContain("plan_1");
  });
});

describe("formatJson", () => {
  it("returns pretty-printed JSON", () => {
    const data = { id: "test", count: 42 };
    const result = formatJson(data);
    expect(result).toBe(JSON.stringify(data, null, 2));
  });

  it("handles arrays", () => {
    const data = [1, 2, 3];
    expect(formatJson(data)).toBe("[\n  1,\n  2,\n  3\n]");
  });
});

describe("output", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("outputs JSON when json option is true", () => {
    const data = { id: "test" };
    output(data, { json: true });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it("outputs table for array with columns", () => {
    const data = [{ id: "1", name: "Test" }];
    const columns: Column[] = [
      { key: "id", header: "ID" },
      { key: "name", header: "Name" },
    ];
    output(data, { columns });
    expect(logSpy).toHaveBeenCalled();
    const logged = logSpy.mock.calls[0]![0] as string;
    expect(logged).toContain("ID");
    expect(logged).toContain("Name");
    expect(logged).toContain("Test");
  });

  it("outputs string directly", () => {
    output("hello world");
    expect(logSpy).toHaveBeenCalledWith("hello world");
  });

  it("outputs key-value pairs for objects", () => {
    output({ Account: "Test Co", Email: "test@example.com" });
    expect(logSpy).toHaveBeenCalledTimes(2);
    const firstCall = logSpy.mock.calls[0]![0] as string;
    expect(firstCall).toContain("Account");
    expect(firstCall).toContain("Test Co");
  });
});

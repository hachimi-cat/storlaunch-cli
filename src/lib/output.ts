import chalk from "chalk";

export interface Column {
  key: string;
  header: string;
  width?: number;
}

/**
 * Formats data as a table for terminal output.
 */
export function formatTable(data: Record<string, unknown>[], columns: Column[]): string {
  if (data.length === 0) {
    return chalk.dim("No results.");
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const headerLen = col.header.length;
    const maxDataLen = data.reduce((max, row) => {
      const val = String(row[col.key] ?? "");
      return Math.max(max, val.length);
    }, 0);
    return col.width ?? Math.max(headerLen, Math.min(maxDataLen, 40));
  });

  // Header row
  const header = columns
    .map((col, i) => chalk.bold(col.header.padEnd(widths[i]!)))
    .join("  ");

  // Separator
  const separator = widths.map((w) => "─".repeat(w)).join("──");

  // Data rows
  const rows = data.map((row) =>
    columns
      .map((col, i) => {
        const val = String(row[col.key] ?? "");
        return val.length > widths[i]! ? val.slice(0, widths[i]! - 1) + "…" : val.padEnd(widths[i]!);
      })
      .join("  ")
  );

  return [header, separator, ...rows].join("\n");
}

/**
 * Formats data as JSON (for --json flag).
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Outputs data in the appropriate format based on the --json flag.
 */
export function output(data: unknown, options?: { json?: boolean; columns?: Column[] }): void {
  if (options?.json) {
    console.log(formatJson(data));
    return;
  }

  if (Array.isArray(data) && options?.columns) {
    console.log(formatTable(data as Record<string, unknown>[], options.columns));
    return;
  }

  if (typeof data === "string") {
    console.log(data);
    return;
  }

  // Fallback: key-value display for objects
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    const maxKeyLen = Math.max(...entries.map(([k]) => k.length));
    for (const [key, value] of entries) {
      console.log(`${chalk.bold(key.padEnd(maxKeyLen))}  ${value}`);
    }
    return;
  }

  console.log(formatJson(data));
}

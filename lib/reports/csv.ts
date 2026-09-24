/** CSV building for exports. Pure. */

export type CsvValue = string | number | boolean | null | undefined;

/**
 * Quote a cell per RFC 4180, and neutralize spreadsheet formulas: text starting with = + - @ or a
 * tab/CR could run as a formula in Excel/Sheets, so it gets a leading apostrophe. Numbers are left as numbers.
 */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  // BOM so Excel opens UTF-8 (currency symbols, en dashes) correctly.
  return "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function csvFilename(view: string, from: string, to: string): string {
  return `attribution-${view.replace(/[^a-z0-9-]/gi, "")}-${from}_to_${to}.csv`;
}

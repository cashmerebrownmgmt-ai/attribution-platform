import { describe, expect, it } from "vitest";
import { generateDemo } from "@/lib/demo/generate";
import { csvCell, csvFilename, toCsv } from "@/lib/reports/csv";
import { EXPORT_VIEWS, exportTable, isExportView } from "@/lib/reports/exports";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('Say "hi", ok')).toBe('"Say ""hi"", ok"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(1.23456789)).toBe("1.2346");
    expect(csvCell(Number.NaN)).toBe("");
  });
  it("neutralizes spreadsheet formulas in text but not numbers", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("-5");
  });
  it("builds a UTF-8 CSV with a BOM and CRLF rows", () => {
    expect(toCsv(["A", "B"], [[1, "x"]])).toBe("﻿A,B\r\n1,x\r\n");
  });
  it("makes safe filenames", () => {
    expect(csvFilename("ads/../x", "2026-09-01", "2026-09-24")).toBe("attribution-adsx-2026-09-01_to_2026-09-24.csv");
  });
});

describe("exportTable", () => {
  const demo = generateDemo({ endDay: "2026-09-24" });
  const f = { range: { from: "2026-09-18", to: "2026-09-24" }, model: "last_non_direct" as const, platform: "all" as const };

  it("produces rows matching the headers for every view", () => {
    for (const view of Object.keys(EXPORT_VIEWS)) {
      expect(isExportView(view)).toBe(true);
      const t = exportTable(demo, f, view as keyof typeof EXPORT_VIEWS);
      expect(t.rows.length).toBeGreaterThan(0);
      for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
    }
    expect(isExportView("secrets")).toBe(false);
  });

  it("daily export has one row per day and totals match revenue", () => {
    const t = exportTable(demo, f, "daily");
    expect(t.rows.map((r) => r[0])).toEqual(["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"]);
    const orders = exportTable(demo, f, "orders");
    const dailyRevenue = t.rows.reduce((s, r) => s + (r[1] as number), 0);
    const orderRevenue = orders.rows.reduce((s, r) => s + (r[2] as number), 0);
    expect(dailyRevenue).toBeCloseTo(orderRevenue, 0);
  });

  it("respects the platform filter", () => {
    const t = exportTable(demo, { ...f, platform: "tiktok" }, "ads");
    expect(new Set(t.rows.map((r) => r[0]))).toEqual(new Set(["TikTok"]));
  });
});

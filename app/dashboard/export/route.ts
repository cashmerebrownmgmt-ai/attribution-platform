import { requireMember } from "@/lib/auth";
import { currentMode, getDashboardData, todayUtc } from "@/lib/dashboard/data";
import { parseFilters } from "@/lib/dashboard/filters";
import { csvFilename, toCsv } from "@/lib/reports/csv";
import { exportTable, isExportView } from "@/lib/reports/exports";

/** CSV download of any dashboard view, using the same filters as the page (?view=…&range=…). */
export async function GET(req: Request) {
  await requireMember("viewer", "/dashboard");
  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  if (!isExportView(view)) return new Response("Unknown export view", { status: 400 });

  const f = parseFilters(Object.fromEntries(url.searchParams), todayUtc());
  const data = await getDashboardData(await currentMode());
  const { headers, rows } = exportTable(data, f, view);
  const name = csvFilename(`${data.mode === "demo" ? "demo-" : ""}${view}`, f.range.from, f.range.to);

  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

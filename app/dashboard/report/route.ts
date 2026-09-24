import { requireMember } from "@/lib/auth";
import { currentMode, getDashboardData, todayUtc } from "@/lib/dashboard/data";
import { parseFilters } from "@/lib/dashboard/filters";
import { renderReport } from "@/lib/reports/pdf";

export const runtime = "nodejs";

/** PDF performance report for the current filters (?range=…&model=…&platform=…). */
export async function GET(req: Request) {
  await requireMember("viewer", "/dashboard");
  const url = new URL(req.url);
  const f = parseFilters(Object.fromEntries(url.searchParams), todayUtc());
  const data = await getDashboardData(await currentMode());
  const pdf = await renderReport(data, f);
  const name = `attribution-report-${data.mode === "demo" ? "demo-" : ""}${f.range.from}_to_${f.range.to}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

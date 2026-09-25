import { requireMember } from "@/lib/auth";
import { getDailyReport } from "@/lib/daily-report-data";
import { currentMode, getDashboardData } from "@/lib/dashboard/data";
import { renderDailyReport } from "@/lib/reports/daily-pdf";

export const runtime = "nodejs";

/** PDF of a daily report (?day=YYYY-MM-DD, default yesterday). */
export async function GET(req: Request) {
  await requireMember("viewer", "/dashboard/daily");
  const param = new URL(req.url).searchParams.get("day");
  const day = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : null;
  const mode = await currentMode();
  const result = await getDailyReport(mode, day);
  if (!result) return new Response("No report for that day", { status: 404 });
  const data = await getDashboardData(mode);
  const pdf = await renderDailyReport(result.report, data.settings.businessName);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="daily-report-${mode === "demo" ? "demo-" : ""}${result.report.day}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

import "server-only";
import { buildDailyReport, reportDayFor, type DailyReport } from "./daily-report";
import { getDashboardData, todayUtc } from "./dashboard/data";
import { db } from "./db";
import { addDays } from "./metrics/compute";
import { loadSessions } from "./sessions-data";

/** Build the report for a day from current data (sessions from two weeks before it through the next UTC day). */
export async function computeDailyReport(mode: "live" | "demo", day: string, now = Date.now()): Promise<DailyReport> {
  const [data, sessions] = await Promise.all([getDashboardData(mode), loadSessions(mode, { from: addDays(day, -14), to: addDays(day, 1) }, todayUtc())]);
  return buildDailyReport(data, sessions, day, { now });
}

/** Build yesterday's report and save it. Called by the morning job. */
export async function saveDailyReport(now = Date.now()): Promise<DailyReport> {
  const report = await computeDailyReport("live", reportDayFor(now), now);
  const { error } = await db().from("daily_reports").upsert({ day: report.day, generated_at: report.generatedAt, report }, { onConflict: "day" });
  if (error) throw new Error(`daily_reports save failed: ${error.message}`);
  return report;
}

export async function listReportDays(limit = 60): Promise<string[]> {
  const { data, error } = await db().from("daily_reports").select("day").order("day", { ascending: false }).limit(limit);
  return error ? [] : (data ?? []).map((r) => String(r.day));
}

/**
 * The saved report for a day. If the morning job hasn't saved yesterday's yet, build it now
 * (without saving) so the page is never empty. Demo mode always builds from demo data.
 */
export async function getDailyReport(mode: "live" | "demo", day: string | null): Promise<{ report: DailyReport; saved: boolean } | null> {
  const yesterday = reportDayFor(Date.now());
  const want = day ?? yesterday;
  if (mode === "demo") return { report: await computeDailyReport("demo", want), saved: false };
  const { data } = await db().from("daily_reports").select("report").eq("day", want).maybeSingle();
  if (data?.report) return { report: data.report as DailyReport, saved: true };
  if (want === yesterday) return { report: await computeDailyReport("live", want), saved: false };
  return null;
}

import { alertEmail, alertsFor, dueAlerts, type AlertLogEntry } from "@/lib/alerts";
import { ownerEmail } from "@/lib/access";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getDashboardData } from "@/lib/dashboard/data";
import { saveDailyReport } from "@/lib/daily-report-data";
import { refreshJourneys } from "@/lib/journey-refresh";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { morningPush, parsePrefs, problemPushId, problemsToPush } from "@/lib/goal-alerts";
import { clearResolvedProblems, markPushesSent, sendPushes, sentPushIds } from "@/lib/push";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Morning job (Vercel Cron): saves yesterday's daily report, then emails the owner about new alerts
 * (with a reminder once a day while they last).
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  // Shopify finishes journey data after checkout; refresh the last few days before reporting on them.
  await refreshJourneys(0, 3);
  // The daily report goes first: it should be ready even if the alert email fails.
  let reportDay: string | null = null;
  let summary: string[] = [];
  try {
    const report = await saveDailyReport(now);
    reportDay = report.day;
    summary = report.summary;
  } catch (e) {
    console.error("daily report failed:", e instanceof Error ? e.message : e);
  }

  const data = await getDashboardData("live");
  const alerts = alertsFor(data, now);
  const { data: log, error } = await db().from("alert_log").select("id, last_sent_at");
  if (error) return Response.json({ error: "alert_log read failed" }, { status: 500 });
  const due = dueAlerts(alerts, (log ?? []) as AlertLogEntry[], now);

  // Phone: one notification with the report's headline, plus any important problem not pushed yet.
  let pushed = 0;
  try {
    const prefs = parsePrefs((await getSettings())?.notify);
    const problems = problemsToPush(alerts);
    await clearResolvedProblems(problems.map((a) => problemPushId(a.id)));
    const sent = await sentPushIds([...(reportDay ? [`daily:${reportDay}`] : []), ...problems.map((a) => problemPushId(a.id))]);
    const fresh = problems.filter((a) => !sent.has(problemPushId(a.id)));
    const push = reportDay && sent.has(`daily:${reportDay}`) ? morningPush(null, fresh, prefs) : morningPush(reportDay ? { day: reportDay, summary } : null, fresh, prefs);
    if (push) {
      const r = await sendPushes([push]);
      pushed = r.sent;
      if (r.sent > 0) await markPushesSent([push, ...fresh.map((a) => ({ id: problemPushId(a.id), title: a.title, body: a.detail, url: "/dashboard/health" }))]);
    }
  } catch (e) {
    console.error("alerts: push failed:", e instanceof Error ? e.message : "");
  }

  const to = ownerEmail(process.env);
  if (due.length === 0 || !to) return Response.json({ reportDay, alerts: alerts.length, due: 0, sent: false, pushed });

  const origin = process.env.APP_URL || new URL(req.url).origin;
  const sent = await sendEmail({ to, ...alertEmail(due, `${origin}/dashboard/health`) });
  if (!sent.ok) {
    console.error("alerts: email failed:", sent.error);
    return Response.json({ reportDay, alerts: alerts.length, due: due.length, sent: false, error: sent.error }, { status: 502 });
  }

  const at = new Date(now).toISOString();
  const { error: upsertError } = await db()
    .from("alert_log")
    .upsert(due.map((a) => ({ id: a.id, last_sent_at: at, last_title: a.title })), { onConflict: "id" });
  if (upsertError) console.error("alerts: alert_log write failed:", upsertError.message);
  return Response.json({ reportDay, alerts: alerts.length, due: due.length, sent: true, pushed });
}

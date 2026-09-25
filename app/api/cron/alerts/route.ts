import { alertEmail, alertsFor, dueAlerts, type AlertLogEntry } from "@/lib/alerts";
import { ownerEmail } from "@/lib/access";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getDashboardData } from "@/lib/dashboard/data";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/** Daily alert check (Vercel Cron). Emails the owner about new alerts, and reminds once a day while they last. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const data = await getDashboardData("live");
  const now = Date.now();
  const alerts = alertsFor(data, now);
  const { data: log, error } = await db().from("alert_log").select("id, last_sent_at");
  if (error) return Response.json({ error: "alert_log read failed" }, { status: 500 });
  const due = dueAlerts(alerts, (log ?? []) as AlertLogEntry[], now);

  const to = ownerEmail(process.env);
  if (due.length === 0 || !to) return Response.json({ alerts: alerts.length, due: 0, sent: false });

  const origin = process.env.APP_URL || new URL(req.url).origin;
  const sent = await sendEmail({ to, ...alertEmail(due, `${origin}/dashboard/health`) });
  if (!sent.ok) {
    console.error("alerts: email failed:", sent.error);
    return Response.json({ alerts: alerts.length, due: due.length, sent: false, error: sent.error }, { status: 502 });
  }

  const at = new Date(now).toISOString();
  const { error: upsertError } = await db()
    .from("alert_log")
    .upsert(due.map((a) => ({ id: a.id, last_sent_at: at, last_title: a.title })), { onConflict: "id" });
  if (upsertError) console.error("alerts: alert_log write failed:", upsertError.message);
  return Response.json({ alerts: alerts.length, due: due.length, sent: true });
}

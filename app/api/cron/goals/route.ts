import { alertsFor } from "@/lib/alerts";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getDashboardData } from "@/lib/dashboard/data";
import { combine, goalPushes, isQuiet, parsePrefs, problemPushId, problemsToPush, unsent, type Push } from "@/lib/goal-alerts";
import { kpis } from "@/lib/metrics/compute";
import { refreshMeta } from "@/lib/meta-refresh";
import { clearResolvedProblems, markPushesSent, sendPushes, sentPushIds } from "@/lib/push";
import { getSettings } from "@/lib/settings";
import { storeDay, storeHours } from "@/lib/tz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Goal check, every ~15 minutes (GitHub Actions calls it with the cron secret): pulls today's Meta
 * spend, compares today (store time) with the owner's goals, and pushes what's new: goal alerts
 * (once a day each, not overnight) and important problems (once when they start).
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const hour = storeHours(now);
  const meta = await refreshMeta(5 * 60_000);
  const [data, settings] = await Promise.all([getDashboardData("live"), getSettings()]);
  const prefs = parsePrefs(settings?.notify);
  const day = storeDay(now);
  const k = kpis(data, { model: "last_non_direct", platform: "all" }, { from: day, to: day });

  // Spend alerts on stale numbers would mislead; skip them until Meta syncs again.
  const goalPrefs = meta.status === "failed" ? { ...prefs, on: { ...prefs.on, spendCap: false, loss: false } } : prefs;
  const goals = goalPushes({ day, revenue: k.revenue, spend: k.spend, orders: k.orders }, goalPrefs, data.settings.currency, hour);

  const problems = problemsToPush(alertsFor(data, now));
  const problemIds = problems.map((a) => problemPushId(a.id));
  await clearResolvedProblems(problemIds);
  const problemPushes: Push[] = prefs.on.daily && !isQuiet(hour) ? problems.map((a) => ({ id: problemPushId(a.id), title: a.title, body: a.detail, url: "/dashboard/health" })) : [];

  const candidates = [...problemPushes, ...goals];
  const due = unsent(candidates, await sentPushIds(candidates.map((p) => p.id)));
  const one = combine(due);
  const result = one ? await sendPushes([one]) : { sent: 0, failed: 0, devices: 0 };
  if (result.sent > 0) await markPushesSent(due);
  return Response.json({ day, hour: Math.floor(hour), revenue: k.revenue, spend: k.spend, meta: meta.status, due: due.map((p) => p.id), ...result });
}

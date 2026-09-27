import { isCronAuthorized } from "@/lib/cron-auth";
import { getDashboardData } from "@/lib/dashboard/data";
import { goalPushes, parsePrefs, unsent } from "@/lib/goal-alerts";
import { kpis } from "@/lib/metrics/compute";
import { refreshMeta } from "@/lib/meta-refresh";
import { markPushesSent, sendPushes, sentPushIds } from "@/lib/push";
import { getSettings } from "@/lib/settings";
import { storeToday } from "@/lib/tz";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Goal check, every ~15 minutes (GitHub Actions calls it with the cron secret): pulls today's Meta
 * spend, compares today (store time) with the owner's goals and pushes what's new to their phone.
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const meta = await refreshMeta(5 * 60_000);
  const [data, settings] = await Promise.all([getDashboardData("live"), getSettings()]);
  const prefs = parsePrefs(settings?.notify);
  const day = storeToday();
  const k = kpis(data, { model: "last_non_direct", platform: "all" }, { from: day, to: day });
  // Spend alerts on stale numbers would mislead; skip them until Meta syncs again.
  const pushes = goalPushes({ day, revenue: k.revenue, spend: k.spend, orders: k.orders }, meta.status === "failed" ? { ...prefs, on: { ...prefs.on, spendCap: false, loss: false } } : prefs, data.settings.currency);
  const due = unsent(pushes, await sentPushIds(pushes.map((p) => p.id)));
  const result = await sendPushes(due);
  if (result.sent > 0) await markPushesSent(due);
  return Response.json({ day, revenue: k.revenue, spend: k.spend, meta: meta.status, due: due.map((p) => p.id), ...result });
}

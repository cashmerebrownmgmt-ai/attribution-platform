/**
 * Phone push alerts against the owner's daily goals. Pure: takes today's totals and preferences,
 * returns the notifications to send. Each has a per-day ID so it's sent at most once a day.
 */
import { z } from "zod";
import type { Alert } from "./alerts";

const money = (n: number | null) => z.coerce.number().min(0).max(1_000_000).nullable().catch(n);

export const notifySchema = z.object({
  /** Push when today's ad spend passes this. */
  spendCap: money(null),
  /** Push when today's revenue reaches this. */
  revenueGoal: money(null),
  /** "Losing money today" waits until spend reaches this, so it doesn't fire on the day's first dollars. */
  lossMinSpend: z.coerce.number().min(0).max(1_000_000).catch(50),
  on: z
    .object({
      spendCap: z.boolean().catch(true),
      loss: z.boolean().catch(true),
      revenueGoal: z.boolean().catch(true),
      daily: z.boolean().catch(true),
    })
    .catch({ spendCap: true, loss: true, revenueGoal: true, daily: true }),
});

export type NotifyPrefs = z.infer<typeof notifySchema>;

/** Preferences from the settings row, with defaults for anything missing or invalid. */
export function parsePrefs(json: unknown): NotifyPrefs {
  return notifySchema.parse(json && typeof json === "object" ? { on: {}, ...json } : { on: {} });
}

export type Push = { id: string; title: string; body: string; url: string };

export type DayTotals = { day: string; revenue: number; spend: number; orders: number };

const fmt = (n: number, cur: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);

/** No goal pushes overnight (store time); anything still true is sent at 8 AM. */
export const QUIET_FROM = 22;
export const QUIET_UNTIL = 8;
/** Spend runs ahead of sales in the morning, so "losing money" waits until the afternoon. */
export const LOSS_AFTER = 12;

export const isQuiet = (hour: number) => hour >= QUIET_FROM || hour < QUIET_UNTIL;

/** Goal pushes due for today's totals so far, at `hour` (store time, e.g. 14.5). */
export function goalPushes(t: DayTotals, prefs: NotifyPrefs, currency: string, hour: number): Push[] {
  if (isQuiet(hour)) return [];
  const out: Push[] = [];
  const profit = t.revenue - t.spend;
  const sales = `${fmt(t.revenue, currency)} in sales from ${t.orders} order${t.orders === 1 ? "" : "s"}`;

  if (prefs.on.spendCap && prefs.spendCap !== null && prefs.spendCap > 0 && t.spend > prefs.spendCap) {
    out.push({
      id: `goal:spend-cap:${t.day}`,
      title: `Ad spend passed ${fmt(prefs.spendCap, currency)} today`,
      body: `${fmt(t.spend, currency)} spent so far, ${sales}. Profit ${fmt(profit, currency)}.`,
      url: "/dashboard/campaigns?range=today",
    });
  }
  if (prefs.on.loss && hour >= LOSS_AFTER && t.spend >= Math.max(prefs.lossMinSpend, 1) && profit < 0) {
    out.push({
      id: `goal:loss:${t.day}`,
      title: "Losing money today",
      body: `Ads have spent ${fmt(t.spend, currency)} against ${sales}: ${fmt(profit, currency)} so far.`,
      url: "/dashboard?range=today",
    });
  }
  if (prefs.on.revenueGoal && prefs.revenueGoal !== null && prefs.revenueGoal > 0 && t.revenue >= prefs.revenueGoal) {
    out.push({
      id: `goal:revenue:${t.day}`,
      title: `Revenue goal hit: ${fmt(t.revenue, currency)} today 🎉`,
      body: `${t.orders} order${t.orders === 1 ? "" : "s"}, ${fmt(t.spend, currency)} ad spend, ${fmt(profit, currency)} profit.`,
      url: "/dashboard?range=today",
    });
  }
  return out;
}

/**
 * Problems worth waking the phone for: things that are broken right now. Chronic setup warnings
 * (UTM tags, pixel coverage, match rate) and ad performance stay on the dashboard and in the report.
 */
const PUSH_WORTHY = new Set(["orders-stopped", "health-tracker", "health-webhooks", "health-sync", "health-sync-failing-meta"]);

export const problemPushId = (alertId: string) => `push:${alertId}`;

/** The important problems among the alerts, each pushed once when it starts (not repeated daily). */
export function problemsToPush(alerts: Alert[]): Alert[] {
  return alerts.filter((a) => a.severity === "critical" && PUSH_WORTHY.has(a.id));
}

/**
 * The one morning notification: yesterday's report headline, with any new important problem folded
 * in. `newProblems` are those not pushed before.
 */
export function morningPush(report: { day: string; summary: string[] } | null, newProblems: Alert[], prefs: NotifyPrefs): Push | null {
  if (!prefs.on.daily) return null;
  const n = newProblems.length;
  if (!report && n === 0) return null;
  const problem = n === 1 ? newProblems[0].title : n > 1 ? `${n} problems need attention: ${newProblems.map((a) => a.title).join("; ")}` : null;
  if (!report) return { id: `problems:${newProblems.map((a) => a.id).join(",")}`, title: problem!, body: newProblems[0].detail, url: "/dashboard/health" };
  return {
    id: `daily:${report.day}`,
    title: n ? `Daily report ready · ${n} problem${n > 1 ? "s" : ""} ⚠️` : "Your daily report is ready",
    body: [report.summary[0], problem].filter(Boolean).join(" ") || "Tap to read it.",
    url: n ? "/dashboard/health" : `/dashboard/daily?day=${report.day}`,
  };
}

/** Several goal alerts due at once arrive as one notification (each ID is still logged as sent). */
export function combine(pushes: Push[]): Push | null {
  if (pushes.length <= 1) return pushes[0] ?? null;
  return { id: pushes.map((p) => p.id).join("+"), title: pushes.map((p) => p.title.replace(/ 🎉$/, "")).join(" · "), body: pushes[0].body, url: pushes[0].url };
}

/** Drop pushes already sent (by ID). Goal and report IDs carry the day, so each is sent once. */
export function unsent(pushes: Push[], sentIds: Set<string>): Push[] {
  return pushes.filter((p) => !sentIds.has(p.id));
}

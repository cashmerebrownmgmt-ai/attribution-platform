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

/** Goal pushes due for today's totals so far. */
export function goalPushes(t: DayTotals, prefs: NotifyPrefs, currency: string): Push[] {
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
  if (prefs.on.loss && t.spend >= Math.max(prefs.lossMinSpend, 1) && profit < 0) {
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
 * The morning push: yesterday's report headline, and the critical problems among the day's alerts
 * (once a day while they last, like the alert email).
 */
export function morningPushes(report: { day: string; summary: string[] } | null, alerts: Alert[], prefs: NotifyPrefs, today: string): Push[] {
  if (!prefs.on.daily) return [];
  const out: Push[] = [];
  if (report) {
    out.push({ id: `daily:${report.day}`, title: "Your daily report is ready", body: report.summary[0] ?? "Tap to read it.", url: `/dashboard/daily?day=${report.day}` });
  }
  for (const a of alerts.filter((x) => x.severity === "critical")) {
    out.push({ id: `push:${a.id}:${today}`, title: a.title, body: a.detail, url: "/dashboard/health" });
  }
  return out;
}

/** Drop pushes already sent (by ID). Goal and report IDs carry the day, so each is sent once. */
export function unsent(pushes: Push[], sentIds: Set<string>): Push[] {
  return pushes.filter((p) => !sentIds.has(p.id));
}

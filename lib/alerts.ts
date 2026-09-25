/**
 * Alerts: the few things worth an email. Broken tracking (from the health checks), orders that stop,
 * ads spending without sales, and paid returns below break-even. Pure; the cron route sends them.
 */
import { addDays, dayOf } from "./metrics/compute";
import { healthChecks } from "./metrics/health";
import type { DashboardData } from "./metrics/types";

export type Alert = { id: string; severity: "critical" | "warning"; title: string; detail: string; fix?: string };

const DAY = 86_400_000;
const money = (n: number, cur: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);

export function alertsFor(data: DashboardData, now = Date.parse(data.generatedAt)): Alert[] {
  const alerts: Alert[] = [];
  const cur = data.settings.currency;

  // 1. Broken tracking: only the checks that are failing outright.
  for (const c of healthChecks(data, now)) {
    if (c.level === "bad") alerts.push({ id: `health-${c.id}`, severity: "critical", title: `${c.name}: needs attention`, detail: c.detail, fix: c.fix });
  }

  // 2. Orders stopped: none in 48 hours when the store normally gets several a day.
  const live = data.orders.filter((o) => !o.cancelled);
  const recent = live.filter((o) => now - Date.parse(o.createdAt) <= 2 * DAY).length;
  const baseline = live.filter((o) => {
    const age = now - Date.parse(o.createdAt);
    return age > 2 * DAY && age <= 30 * DAY;
  }).length / 28;
  if (recent === 0 && baseline >= 3) {
    alerts.push({
      id: "orders-stopped",
      severity: "critical",
      title: "No orders in the last 48 hours",
      detail: `You usually get about ${baseline.toFixed(1)} orders a day.`,
      fix: "Place a test order to check checkout works, and check Shopify for payment or theme problems.",
    });
  }

  // 3. Ads spending without sales over the last 3 full days.
  const today = dayOf(new Date(now).toISOString());
  const from = addDays(today, -3);
  const spend = new Map<string, number>();
  for (const i of data.insights) if (i.date >= from && i.date < today) spend.set(`${i.platform}:${i.adId}`, (spend.get(`${i.platform}:${i.adId}`) ?? 0) + i.spend);
  const sold = new Set(
    live
      .filter((o) => dayOf(o.createdAt) >= from && dayOf(o.createdAt) < today && o.touches.last_non_direct.adId)
      .map((o) => `${o.touches.last_non_direct.platform}:${o.touches.last_non_direct.adId}`),
  );
  const limit = Math.max(30, 2 * (data.settings.targetCpa ?? 25));
  const burning = data.ads
    .map((a) => ({ ad: a, spent: spend.get(`${a.platform}:${a.id}`) ?? 0 }))
    .filter((x) => x.spent >= limit && !sold.has(`${x.ad.platform}:${x.ad.id}`))
    .sort((a, b) => b.spent - a.spent);
  if (burning.length) {
    const total = burning.reduce((t, x) => t + x.spent, 0);
    alerts.push({
      id: "ads-no-sales",
      severity: "warning",
      title: `${burning.length} ad${burning.length > 1 ? "s" : ""} spent ${money(total, cur)} in 3 days with no sales`,
      detail: burning.slice(0, 5).map((x) => `${x.ad.name} (${x.ad.platform}): ${money(x.spent, cur)}`).join("; ") + (burning.length > 5 ? "; …" : ""),
      fix: "Check each ad's landing page and UTM tags first; if tracking is fine, pause it or cut its budget.",
    });
  }

  // 4. Paid return below break-even over the last 7 days.
  const weekFrom = addDays(today, -7);
  const adSpend = data.insights.filter((i) => i.date >= weekFrom && i.date < today).reduce((t, i) => t + i.spend, 0);
  const adRevenue = live.filter((o) => dayOf(o.createdAt) >= weekFrom && dayOf(o.createdAt) < today && o.touches.last_non_direct.platform).reduce((t, o) => t + o.revenue, 0);
  const breakeven = data.settings.breakevenRoas;
  if (breakeven && adSpend >= 100 && adRevenue / adSpend < breakeven) {
    alerts.push({
      id: "roas-below-breakeven",
      severity: "warning",
      title: `Ads returned ${(adRevenue / adSpend).toFixed(2)}× last week, below your ${breakeven.toFixed(2)}× break-even`,
      detail: `${money(adSpend, cur)} spent, ${money(adRevenue, cur)} in sales credited to ads (last non-direct click).`,
      fix: "Open Campaigns and sort by ROAS: cut the bottom performers first rather than everything at once.",
    });
  }

  return alerts;
}

export type AlertLogEntry = { id: string; last_sent_at: string };

/** Alerts to email now: new ones, and ones still firing a day after the last email about them. */
export function dueAlerts(alerts: Alert[], log: AlertLogEntry[], now: number, remindAfterHours = 24): Alert[] {
  const last = new Map(log.map((l) => [l.id, Date.parse(l.last_sent_at)]));
  return alerts.filter((a) => {
    const t = last.get(a.id);
    return t === undefined || now - t >= remindAfterHours * 3_600_000;
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function alertEmail(alerts: Alert[], dashboardUrl: string): { subject: string; html: string; text: string } {
  const ordered = [...alerts].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  const critical = alerts.filter((a) => a.severity === "critical").length;
  const subject = critical
    ? `⚠ ${critical} critical alert${critical > 1 ? "s" : ""}: ${ordered[0].title}`
    : `${alerts.length} alert${alerts.length > 1 ? "s" : ""}: ${ordered[0].title}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
${ordered
  .map(
    (a) => `<div style="border-left:4px solid ${a.severity === "critical" ? "#d03b3b" : "#e0a100"};padding:8px 12px;margin:0 0 12px">
<b>${esc(a.title)}</b><br><span>${esc(a.detail)}</span>${a.fix ? `<br><i>What to do: ${esc(a.fix)}</i>` : ""}</div>`,
  )
  .join("\n")}
<p><a href="${esc(dashboardUrl)}">Open the dashboard</a></p>
<p style="color:#888;font-size:12px">You get this when something breaks, and a reminder each day it stays broken.</p></div>`;
  const text = ordered.map((a) => `${a.severity === "critical" ? "[CRITICAL] " : ""}${a.title}\n${a.detail}${a.fix ? `\nWhat to do: ${a.fix}` : ""}`).join("\n\n") + `\n\n${dashboardUrl}\n`;
  return { subject, html, text };
}

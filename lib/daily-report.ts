/**
 * The daily report: yesterday in the store's time zone, compared with the same weekday last week
 * and the 7 days before, plus what to do today. Pure and JSON-serializable, so the morning job can
 * save a snapshot and the page and PDF render the same thing.
 */
import type { Abandonment } from "./abandonment";
import { STEP_LABELS } from "./abandonment";
import { alertsFor, type Alert } from "./alerts";
import { STORE_TZ } from "./tz";
import { behaviorTips, type Tip } from "./behavior-insights";
import { CHANNEL_LABELS } from "./debug";
import { addDays, ctrDecay, fatigue, performance, ratio, spendByDay } from "./metrics/compute";
import { healthChecks } from "./metrics/health";
import { adSignal, type Verdict } from "./metrics/signals";
import type { DashboardData, OrderFact } from "./metrics/types";
import type { SessionFact } from "./sessions";

export const REPORT_TZ = STORE_TZ;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of an instant in a time zone. */
export function localDay(iso: string | number, tz = REPORT_TZ): string {
  let f = formatters.get(tz);
  if (!f) formatters.set(tz, (f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })));
  return f.format(new Date(iso));
}

export type KpiKey = "revenue" | "profit" | "orders" | "aov" | "newCustomers" | "sessions" | "conversionRate" | "adSpend" | "adRoas" | "platformRoas";
export type ReportKpi = { key: KpiKey; label: string; kind: "money" | "number" | "pct" | "roas"; value: number | null; lastWeek: number | null; avg7: number | null; upIsGood: boolean };
export type ReportRow = { name: string; detail: string; value: number; compare: number | null };
const ACTIONABLE: Verdict[] = ["pause", "refresh", "scale"];

export type ReportAction = { verdict: Verdict; name: string; platform: string; reasons: string[] };

export type DailyReport = {
  day: string;
  timezone: string;
  generatedAt: string;
  mode: "live" | "demo";
  currency: string;
  summary: string[];
  kpis: ReportKpi[];
  channels: ReportRow[];
  topAds: { name: string; platform: string; spend: number; revenue: number; roas: number | null; platformRoas: number | null }[];
  products: ReportRow[];
  actions: ReportAction[];
  tips: Tip[];
  alerts: Alert[];
  health: { name: string; level: "ok" | "warn" | "bad"; detail: string }[];
  /** Absent on reports saved before this section existed. */
  abandoned?: ReportAbandoned;
};

export type ReportAbandoned = {
  carts: number;
  checkouts: number;
  cartRate: number | null;
  checkoutRate: number | null;
  bounceRate: number | null;
  /** Null when Shopify couldn't be reached. */
  valueLeft: number | null;
  currency: string;
  funnel: { label: string; count: number }[];
  /** Shopify's abandoned checkouts that day: time, value, products and, when matched, the visit's source. */
  list: { at: string; value: number; items: string[]; source: string | null; step: string | null }[];
};

/** The daily report's abandonment section, from the day's abandonment analysis. */
export function abandonedSection(a: Abandonment, shopifyAvailable: boolean): ReportAbandoned {
  const byKey = new Map(a.rows.map((r) => [r.key, r]));
  return {
    carts: a.abandonedCarts,
    checkouts: a.abandonedCheckouts,
    cartRate: a.cartAbandonRate,
    checkoutRate: a.checkoutAbandonRate,
    bounceRate: a.bounceRate,
    valueLeft: shopifyAvailable ? a.valueLeft : null,
    currency: a.currency,
    funnel: a.funnel.map((f) => ({ label: f.label, count: f.count })),
    list: a.shopify
      .map((x) => {
        const row = x.matchedKey ? byKey.get(x.matchedKey) : undefined;
        return { at: x.createdAt, value: x.value, items: x.items, source: row?.source ?? null, step: row ? STEP_LABELS[row.furthest] : null };
      })
      .sort((p, q) => q.at.localeCompare(p.at)),
  };
}

type DayStats = { revenue: number; orders: number; newCustomers: number; sessions: number; conversions: number; adSpend: number; adRevenue: number; platformRevenue: number };

function statsFor(day: string, ordersByDay: Map<string, OrderFact[]>, sessionsByDay: Map<string, SessionFact[]>, data: DashboardData): DayStats {
  const os = ordersByDay.get(day) ?? [];
  const ss = sessionsByDay.get(day) ?? [];
  // Ad platforms report days in the ad account's own time zone.
  const ins = data.insights.filter((i) => i.date === day);
  return {
    revenue: os.reduce((t, o) => t + o.revenue, 0),
    orders: os.length,
    newCustomers: os.filter((o) => o.isNew).length,
    sessions: ss.length,
    conversions: ss.filter((s) => s.completed_checkout).length,
    adSpend: [...spendByDay(data, { from: day, to: day }).values()].reduce((t, v) => t + v, 0),
    adRevenue: os.filter((o) => o.touches.last_non_direct.platform).reduce((t, o) => t + o.revenue, 0),
    platformRevenue: ins.reduce((t, i) => t + (i.platformRevenue ?? 0), 0),
  };
}

const KPI_DEFS: { key: KpiKey; label: string; kind: ReportKpi["kind"]; upIsGood: boolean; of: (s: DayStats) => number | null; needsAds?: boolean; needsSessions?: boolean }[] = [
  { key: "revenue", label: "Revenue", kind: "money", upIsGood: true, of: (s) => s.revenue },
  // Digital products: no cost of goods, so revenue minus ad spend is the profit.
  { key: "profit", label: "Profit (revenue − ad spend)", kind: "money", upIsGood: true, of: (s) => s.revenue - s.adSpend },
  { key: "orders", label: "Orders", kind: "number", upIsGood: true, of: (s) => s.orders },
  { key: "aov", label: "Avg. order value", kind: "money", upIsGood: true, of: (s) => ratio(s.revenue, s.orders) },
  { key: "newCustomers", label: "New customers", kind: "number", upIsGood: true, of: (s) => s.newCustomers },
  { key: "sessions", label: "Sessions", kind: "number", upIsGood: true, of: (s) => s.sessions, needsSessions: true },
  { key: "conversionRate", label: "Conversion rate", kind: "pct", upIsGood: true, of: (s) => ratio(s.conversions, s.sessions), needsSessions: true },
  { key: "adSpend", label: "Ad spend", kind: "money", upIsGood: false, of: (s) => s.adSpend, needsAds: true },
  { key: "adRoas", label: "ROAS (your tracking)", kind: "roas", upIsGood: true, of: (s) => ratio(s.adRevenue, s.adSpend), needsAds: true },
  { key: "platformRoas", label: "ROAS (platforms claim)", kind: "roas", upIsGood: true, of: (s) => ratio(s.platformRevenue, s.adSpend), needsAds: true },
];

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null;
};

// Relative to the base's size, so a move from a loss (negative profit) still reads the right way.
const change = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : (a - b) / Math.abs(b));
const pctText = (d: number) => `${Math.abs(Math.round(d * 100))}%`;
const money = (n: number, cur: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
export const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

export function buildDailyReport(data: DashboardData, sessions: SessionFact[], day: string, opts: { now?: number; tz?: string; abandoned?: ReportAbandoned } = {}): DailyReport {
  const tz = opts.tz ?? REPORT_TZ;
  const now = opts.now ?? Date.parse(data.generatedAt);
  const cur = data.settings.currency;
  const live = data.orders.filter((o) => !o.cancelled);
  const hasAds = data.insights.length > 0;
  const hasSessions = sessions.length > 0;

  // Group by local day once: only the last two weeks matter, and time-zone conversion isn't free.
  const earliest = Date.parse(`${addDays(day, -15)}T00:00:00Z`);
  const group = <T,>(xs: T[], at: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
      if (Date.parse(at(x)) < earliest) continue;
      const d = localDay(at(x), tz);
      const g = m.get(d);
      if (g) g.push(x);
      else m.set(d, [x]);
    }
    return m;
  };
  const ordersByDay = group(live, (o) => o.createdAt);
  const sessionsByDay = group(sessions, (s) => s.started_at);
  const dayOrders = (d: string) => ordersByDay.get(d) ?? [];

  const prior = Array.from({ length: 7 }, (_, i) => addDays(day, -(i + 1)));
  const today = statsFor(day, ordersByDay, sessionsByDay, data);
  const week = statsFor(addDays(day, -7), ordersByDay, sessionsByDay, data);
  const priorStats = prior.map((d) => statsFor(d, ordersByDay, sessionsByDay, data));

  const kpis: ReportKpi[] = KPI_DEFS.filter((d) => (!d.needsAds || hasAds) && (!d.needsSessions || hasSessions)).map((d) => ({
    key: d.key,
    label: d.label,
    kind: d.kind,
    upIsGood: d.upIsGood,
    value: d.of(today),
    lastWeek: d.of(week),
    avg7: avg(priorStats.map(d.of)),
  }));
  const k = (key: KpiKey) => kpis.find((x) => x.key === key);

  // Channels: yesterday's revenue by last non-direct channel, vs its 7-day daily average.
  const byChannel = (days: string[]) => {
    const m = new Map<string, number>();
    for (const d of days) for (const o of dayOrders(d)) m.set(o.touches.last_non_direct.channel, (m.get(o.touches.last_non_direct.channel) ?? 0) + o.revenue);
    return m;
  };
  const chToday = byChannel([day]);
  const chPrior = byChannel(prior);
  const channels: ReportRow[] = [...new Set([...chToday.keys(), ...chPrior.keys()])]
    .map((c) => ({ name: CHANNEL_LABELS[c] ?? c, detail: "", value: chToday.get(c) ?? 0, compare: (chPrior.get(c) ?? 0) / 7 }))
    .filter((r) => r.value > 0 || (r.compare ?? 0) >= 1)
    .sort((a, b) => b.value - a.value);

  // Ads yesterday (by the ad platform's day) and actions from the last 7 days.
  const f = { range: { from: day, to: day }, model: "last_non_direct" as const, platform: "all" as const };
  const topAds = performance(data, f, "ad")
    .filter((a) => a.spend > 0 || a.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || b.spend - a.spend)
    .slice(0, 8)
    .map((a) => ({ name: a.name, platform: a.platform, spend: a.spend, revenue: a.revenue, roas: a.roas, platformRoas: a.platformRoas }));

  const week7 = { ...f, range: { from: addDays(day, -6), to: day } };
  const adIndex = new Map(data.ads.map((a) => [`${a.platform}:${a.id}`, a]));
  const endMs = Date.parse(`${day}T23:59:59Z`);
  const actions: ReportAction[] = performance(data, week7, "ad").flatMap((row) => {
    const ad = adIndex.get(row.key);
    if (!ad || row.spend <= 0) return [];
    const ageDays = ad.launchedAt ? Math.floor((endMs - Date.parse(ad.launchedAt)) / 86_400_000) : null;
    const s = adSignal({ row, ctrDecay: ctrDecay(fatigue(data, week7.model, ad.platform, ad.id)), ageDays, settings: data.settings });
    // Only verdicts that ask for a change today; "keep" and "watch" mean leave it alone.
    return ACTIONABLE.includes(s.verdict) ? [{ verdict: s.verdict, name: row.name, platform: row.platform, reasons: s.reasons }] : [];
  });
  actions.sort((a, b) => ACTIONABLE.indexOf(a.verdict) - ACTIONABLE.indexOf(b.verdict));

  // Products sold yesterday.
  const units = new Map<string, { title: string; units: number; revenue: number }>();
  for (const o of dayOrders(day))
      for (const i of o.items) {
        const u = units.get(i.key) ?? { title: i.title, units: 0, revenue: 0 };
        u.units += i.quantity;
        u.revenue += i.revenue;
        units.set(i.key, u);
      }
  const products: ReportRow[] = [...units.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map((u) => ({ name: u.title, detail: `${u.units} sold`, value: Math.round(u.revenue * 100) / 100, compare: null }));

  // Shopper behavior: the last 7 days vs the 7 before (one day is too noisy for these).
  const inDays = (from: string, to: string) => [...sessionsByDay.entries()].filter(([d]) => d >= from && d <= to).flatMap(([, ss]) => ss);
  const tips = behaviorTips(inDays(addDays(day, -6), day), inDays(addDays(day, -13), addDays(day, -7)), 7).slice(0, 3);

  const alerts = alertsFor(data, now);
  // Failing checks are already alerts; list the rest so the report shows what's healthy too.
  const health = healthChecks(data, now)
    .filter((c) => c.level !== "bad")
    .map((c) => ({ name: c.name, level: c.level, detail: c.detail }));

  // Plain-language summary.
  const summary: string[] = [];
  const rev = k("revenue")!;
  const orders = k("orders")!;
  const vsWeek = change(rev.value, rev.lastWeek);
  const vsAvg = change(rev.value, rev.avg7);
  summary.push(
    `${longDay(day)}: ${money(rev.value ?? 0, cur)} from ${orders.value ?? 0} order${orders.value === 1 ? "" : "s"}` +
      (vsWeek !== null ? `, ${vsWeek >= 0 ? "up" : "down"} ${pctText(vsWeek)} on last ${weekday(day)}` : "") +
      (vsAvg !== null ? ` and ${vsAvg >= 0 ? "above" : "below"} your 7-day average by ${pctText(vsAvg)}` : "") +
      ".",
  );
  const spend = k("adSpend");
  const profit = k("profit")!;
  if (spend?.value && profit.value !== null) {
    summary.push(`Profit after ad spend: ${money(profit.value, cur)}${profit.value < 0 ? " (ads cost more than the day's sales)" : ""}.`);
  }
  if (spend?.value) {
    const ours = k("adRoas")!.value;
    const theirs = k("platformRoas")!.value;
    summary.push(
      `Ads spent ${money(spend.value, cur)}. Your tracking credits ${ours !== null ? `${ours.toFixed(2)}×` : "no sales"} back to ads` +
        (theirs !== null ? `; the platforms claim ${theirs.toFixed(2)}×.` : "."),
    );
  }
  const bestChannel = channels[0];
  if (bestChannel && bestChannel.value > 0) summary.push(`Most revenue came from ${bestChannel.name} (${money(bestChannel.value, cur)}).`);
  const bestAd = topAds.find((a) => a.revenue > 0);
  if (bestAd) summary.push(`Best ad: ${bestAd.name} with ${money(bestAd.revenue, cur)} in sales on ${money(bestAd.spend, cur)} spend.`);
  const cr = k("conversionRate");
  const crChange = cr ? change(cr.value, cr.avg7) : null;
  if (cr && crChange !== null && Math.abs(crChange) >= 0.2 && (k("sessions")?.value ?? 0) >= 100)
    summary.push(`Conversion rate was ${((cr.value ?? 0) * 100).toFixed(2)}%, ${crChange >= 0 ? "up" : "down"} ${pctText(crChange)} on the week's average.`);
  const counts = (v: Verdict) => actions.filter((a) => a.verdict === v).length;
  const todo = [counts("scale") && `scale ${counts("scale")}`, counts("pause") && `pause ${counts("pause")}`, counts("refresh") && `refresh ${counts("refresh")}`].filter(Boolean);
  if (todo.length) summary.push(`Suggested today: ${todo.join(", ")} ad${actions.length > 1 ? "s" : ""} (details below).`);
  const ab = opts.abandoned;
  if (ab && (ab.carts || ab.checkouts || (ab.valueLeft ?? 0) > 0)) {
    const parts = [ab.carts ? `${ab.carts} cart${ab.carts === 1 ? "" : "s"}` : null, ab.checkouts ? `${ab.checkouts} checkout${ab.checkouts === 1 ? "" : "s"}` : null].filter(Boolean);
    summary.push(
      `${parts.length ? `${parts.join(" and ")} ${ab.carts + ab.checkouts === 1 ? "was" : "were"} abandoned` : "Checkouts were abandoned"}` +
        (ab.valueLeft ? `; Shopify shows ${money(ab.valueLeft, ab.currency)} left in abandoned checkouts` : "") +
        ".",
    );
  }
  if (alerts.length) summary.push(`${alerts.length} alert${alerts.length > 1 ? "s" : ""} need${alerts.length > 1 ? "" : "s"} attention: ${alerts.map((a) => a.title).join("; ")}.`);

  return {
    day,
    timezone: tz,
    generatedAt: new Date(now).toISOString(),
    mode: data.mode,
    currency: cur,
    summary,
    kpis,
    channels,
    topAds,
    products,
    actions,
    tips,
    alerts,
    health,
    ...(opts.abandoned ? { abandoned: opts.abandoned } : {}),
  };
}

/** The day the morning report covers: yesterday in the report's time zone. */
export function reportDayFor(now: number, tz = REPORT_TZ): string {
  return addDays(localDay(now, tz), -1);
}

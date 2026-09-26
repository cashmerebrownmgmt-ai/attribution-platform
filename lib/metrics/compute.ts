/**
 * Pure dashboard calculations. Every page is a function of (DashboardData, filters).
 * Definitions: docs/phase-3-spec.md § Metrics.
 */
import { storeDay, storeHours } from "../tz";
import type { Model } from "../attribution";
import type { Channel } from "../channel";
import type { Ad, DashboardData, Insight, OrderFact, Platform } from "./types";

export type DateRange = { from: string; to: string }; // YYYY-MM-DD, inclusive, UTC days

export type Filters = {
  range: DateRange;
  model: Model;
  platform: Platform | "all";
};

const DAY_MS = 86_400_000;

// ─── Dates ────────────────────────────────────────────────────────────────────

/** The store-time-zone day of a timestamp (see lib/tz.ts). */
export const dayOf = (iso: string) => storeDay(iso);
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function daysIn(r: DateRange): string[] {
  const out: string[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The equally long period right before `r`. */
export function previousRange(r: DateRange): DateRange {
  const len = daysIn(r).length;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

const inRange = (day: string, r: DateRange) => day >= r.from && day <= r.to;

// ─── Safe math ────────────────────────────────────────────────────────────────

export const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Relative change; null when there's no baseline. */
export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

// ─── Slicing ──────────────────────────────────────────────────────────────────

export function ordersIn(data: DashboardData, r: DateRange): OrderFact[] {
  return data.orders.filter((o) => !o.cancelled && inRange(dayOf(o.createdAt), r));
}

export function insightsIn(data: DashboardData, r: DateRange, platform: Filters["platform"] = "all"): Insight[] {
  return data.insights.filter((i) => inRange(i.date, r) && (platform === "all" || i.platform === platform));
}

/**
 * Ad spend per day. Uses each ad platform's own account-level total where we have it (that is what
 * Ads Manager shows, and it includes ads the API no longer lists), else the sum of the ad-level rows.
 */
export function spendByDay(data: DashboardData, r: DateRange, platform: Filters["platform"] = "all"): Map<string, number> {
  const byPlatform = new Map<string, Map<string, number>>();
  for (const i of insightsIn(data, r, platform)) {
    const m = byPlatform.get(i.platform) ?? new Map<string, number>();
    m.set(i.date, (m.get(i.date) ?? 0) + i.spend);
    byPlatform.set(i.platform, m);
  }
  for (const sync of data.adSync ?? []) {
    if (platform !== "all" && sync.platform !== platform) continue;
    const m = byPlatform.get(sync.platform) ?? new Map<string, number>();
    for (const d of sync.accountDaily) if (inRange(d.date, r)) m.set(d.date, d.spend);
    byPlatform.set(sync.platform, m);
  }
  const out = new Map<string, number>();
  for (const m of byPlatform.values()) for (const [d, v] of m) out.set(d, (out.get(d) ?? 0) + v);
  return out;
}

/** Orders whose credit (under the model) went to the platform filter, or all orders. */
function creditedTo(orders: OrderFact[], model: Model, platform: Filters["platform"]): OrderFact[] {
  return platform === "all" ? orders : orders.filter((o) => o.touches[model].platform === platform);
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

export type Kpis = {
  revenue: number;
  orders: number;
  aov: number | null;
  newCustomers: number;
  newCustomerShare: number | null;
  spend: number;
  /** Revenue credited to ad platforms (under the model). */
  paidRevenue: number;
  paidOrders: number;
  paidNewRevenue: number;
  /** Paid ROAS: paidRevenue ÷ spend. */
  roas: number | null;
  /** Blended ROAS / MER: all revenue ÷ spend. */
  mer: number | null;
  cpa: number | null;
  ncRoas: number | null;
  platformRevenue: number;
  platformRoas: number | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
};

export function kpis(data: DashboardData, f: Pick<Filters, "model" | "platform">, r: DateRange): Kpis {
  const all = ordersIn(data, r);
  const orders = creditedTo(all, f.model, f.platform);
  const paid = orders.filter((o) => o.touches[f.model].platform !== null);
  const ins = insightsIn(data, r, f.platform);

  const revenue = sum(orders, (o) => o.revenue);
  const newOrders = orders.filter((o) => o.isNew);
  const spend = [...spendByDay(data, r, f.platform).values()].reduce((t, v) => t + v, 0);
  const paidRevenue = sum(paid, (o) => o.revenue);
  const paidNewRevenue = sum(paid.filter((o) => o.isNew), (o) => o.revenue);
  const impressions = sum(ins, (i) => i.impressions);
  const clicks = sum(ins, (i) => i.clicks);
  const platformRevenue = sum(ins, (i) => i.platformRevenue ?? 0);

  return {
    revenue: round2(revenue),
    orders: orders.length,
    aov: ratio(revenue, orders.length),
    newCustomers: newOrders.length,
    newCustomerShare: ratio(newOrders.length, orders.length),
    spend: round2(spend),
    paidRevenue: round2(paidRevenue),
    paidOrders: paid.length,
    paidNewRevenue: round2(paidNewRevenue),
    roas: ratio(paidRevenue, spend),
    mer: f.platform === "all" ? ratio(revenue, spend) : ratio(paidRevenue, spend),
    cpa: ratio(spend, paid.length),
    ncRoas: ratio(paidNewRevenue, spend),
    platformRevenue: round2(platformRevenue),
    platformRoas: ratio(platformRevenue, spend),
    impressions,
    clicks,
    ctr: ratio(clicks, impressions),
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    cpc: ratio(spend, clicks),
  };
}

/** `sameTime`: previous is yesterday up to this time of day (for Today), not a whole period. */
export type KpiComparison = { current: Kpis; previous: Kpis; sameTime?: boolean };

/**
 * KPIs for the range and the period before it. When the range is just today (and `now` is given),
 * today so far is compared with yesterday up to the same time, not all of yesterday: orders placed
 * after this time yesterday are left out, and yesterday's ad spend is scaled to the same share of
 * the day (platforms only report spend per day).
 */
export function compareKpis(data: DashboardData, f: Filters, opts: { now?: number } = {}): KpiComparison {
  const current = kpis(data, f, f.range);
  const today = opts.now !== undefined ? storeDay(opts.now) : null;
  if (!today || f.range.from !== today || f.range.to !== today) return { current, previous: kpis(data, f, previousRange(f.range)), sameTime: false };

  const yesterday = addDays(today, -1);
  const cutoff = opts.now! - DAY_MS;
  const share = Math.min(1, Math.max(0, storeHours(opts.now!) / 24));
  const partial: DashboardData = {
    ...data,
    orders: data.orders.filter((o) => dayOf(o.createdAt) !== yesterday || Date.parse(o.createdAt) <= cutoff),
    insights: data.insights.map((i) => (i.date === yesterday ? { ...i, spend: i.spend * share, impressions: Math.round(i.impressions * share), clicks: Math.round(i.clicks * share), platformConversions: i.platformConversions === null ? null : i.platformConversions * share, platformRevenue: i.platformRevenue === null ? null : i.platformRevenue * share } : i)),
    adSync: data.adSync?.map((sync) => ({ ...sync, accountDaily: sync.accountDaily.map((d) => (d.date === yesterday ? { ...d, spend: d.spend * share } : d)) })),
  };
  return { current, previous: kpis(partial, f, { from: yesterday, to: yesterday }), sameTime: true };
}

/** Charts need a few days of context: short ranges are shown as the last `min` days ending on the range's last day. */
export function chartRange(r: DateRange, min = 14): DateRange {
  return daysIn(r).length >= min ? r : { from: addDays(r.to, -(min - 1)), to: r.to };
}

export type HourPoint = { hour: number; revenue: number | null; previous: number };

/**
 * Running revenue through a day, hour by hour (store time), next to the day before. Hours that
 * haven't happened yet are null for the current day.
 */
export function hourlyRevenue(data: DashboardData, f: Pick<Filters, "model" | "platform">, day: string, now?: number): HourPoint[] {
  const cum = (d: string) => {
    const by = new Array(24).fill(0) as number[];
    for (const o of creditedTo(ordersIn(data, { from: d, to: d }), f.model, f.platform)) by[Math.min(23, Math.floor(storeHours(o.createdAt)))] += o.revenue;
    for (let h = 1; h < 24; h++) by[h] += by[h - 1];
    return by.map((v) => Math.round(v * 100) / 100);
  };
  const today = cum(day);
  const before = cum(addDays(day, -1));
  const lastHour = now !== undefined && storeDay(now) === day ? Math.floor(storeHours(now)) : 23;
  return today.map((v, h) => ({ hour: h, revenue: h <= lastHour ? v : null, previous: before[h] }));
}

// ─── Time series ──────────────────────────────────────────────────────────────

export type DayPoint = {
  date: string;
  revenue: number;
  paidRevenue: number;
  spend: number;
  orders: number;
  roas: number | null;
};

export function daily(data: DashboardData, f: Filters): DayPoint[] {
  const points = new Map(
    daysIn(f.range).map((d) => [d, { date: d, revenue: 0, paidRevenue: 0, spend: 0, orders: 0, roas: null as number | null }]),
  );
  for (const o of creditedTo(ordersIn(data, f.range), f.model, f.platform)) {
    const p = points.get(dayOf(o.createdAt));
    if (!p) continue;
    p.revenue += o.revenue;
    p.orders += 1;
    if (o.touches[f.model].platform) p.paidRevenue += o.revenue;
  }
  for (const [d, v] of spendByDay(data, f.range, f.platform)) {
    const p = points.get(d);
    if (p) p.spend += v;
  }
  return [...points.values()].map((p) => ({
    ...p,
    revenue: round2(p.revenue),
    paidRevenue: round2(p.paidRevenue),
    spend: round2(p.spend),
    roas: ratio(p.paidRevenue, p.spend),
  }));
}

// ─── Channels & platforms ─────────────────────────────────────────────────────

export type ChannelRow = { channel: Channel; orders: number; revenue: number; share: number; newCustomers: number };

export function byChannel(data: DashboardData, f: Filters): ChannelRow[] {
  const orders = creditedTo(ordersIn(data, f.range), f.model, f.platform);
  const total = sum(orders, (o) => o.revenue);
  const rows = new Map<Channel, ChannelRow>();
  for (const o of orders) {
    const ch = o.touches[f.model].channel;
    const r = rows.get(ch) ?? { channel: ch, orders: 0, revenue: 0, share: 0, newCustomers: 0 };
    r.orders += 1;
    r.revenue += o.revenue;
    if (o.isNew) r.newCustomers += 1;
    rows.set(ch, r);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, revenue: round2(r.revenue), share: total > 0 ? r.revenue / total : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

export type PerfRow = {
  key: string;
  platform: Platform;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  orders: number;
  revenue: number;
  newCustomers: number;
  roas: number | null;
  cpa: number | null;
  platformRevenue: number;
  platformRoas: number | null;
};

type Acc = Omit<PerfRow, "ctr" | "cpm" | "cpc" | "roas" | "cpa" | "platformRoas">;

function finish(a: Acc): PerfRow {
  return {
    ...a,
    spend: round2(a.spend),
    revenue: round2(a.revenue),
    platformRevenue: round2(a.platformRevenue),
    ctr: ratio(a.clicks, a.impressions),
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
    cpc: ratio(a.spend, a.clicks),
    roas: ratio(a.revenue, a.spend),
    cpa: ratio(a.spend, a.orders),
    platformRoas: ratio(a.platformRevenue, a.spend),
  };
}

const emptyAcc = (key: string, platform: Platform, name: string, status: string): Acc => ({
  key, platform, name, status, spend: 0, impressions: 0, clicks: 0, orders: 0, revenue: 0, newCustomers: 0, platformRevenue: 0,
});

export type Level = "platform" | "campaign" | "adGroup" | "ad";

/**
 * Spend and first-party revenue rolled up to a level. Rows are keyed "platform:id".
 * `parent` limits rows to children of one campaign (for adGroup/ad) or ad group (for ad).
 */
export function performance(
  data: DashboardData,
  f: Filters,
  level: Level,
  parent?: { campaignId?: string; adGroupId?: string },
): PerfRow[] {
  const adIndex = new Map(data.ads.map((a) => [`${a.platform}:${a.id}`, a]));
  const campaignIndex = new Map(data.campaigns.map((c) => [`${c.platform}:${c.id}`, c]));
  const groupIndex = new Map(data.adGroups.map((g) => [`${g.platform}:${g.id}`, g]));

  const keyFor = (platform: Platform, ad: Ad | undefined, campaignId: string | null, adId: string | null): string | null => {
    switch (level) {
      case "platform":
        return platform;
      case "campaign":
        {
        const id = campaignId ?? ad?.campaignId;
        return id ? `${platform}:${id}` : null;
      }
      case "adGroup":
        return ad ? `${platform}:${ad.adGroupId}` : null;
      case "ad":
        return adId ? `${platform}:${adId}` : null;
    }
  };

  const matchesParent = (ad: Ad | undefined, campaignId: string | null) => {
    if (parent?.adGroupId) return ad?.adGroupId === parent.adGroupId;
    if (parent?.campaignId) return (campaignId ?? ad?.campaignId) === parent.campaignId;
    return true;
  };

  const describe = (key: string): [string, string] => {
    if (level === "platform") return [key, "active"];
    const e = level === "campaign" ? campaignIndex.get(key) : level === "adGroup" ? groupIndex.get(key) : adIndex.get(key);
    return [e?.name ?? `Unknown (${key.split(":")[1]})`, e?.status ?? "unknown"];
  };

  const rows = new Map<string, Acc>();
  const acc = (key: string, platform: Platform) => {
    let r = rows.get(key);
    if (!r) {
      const [name, status] = describe(key);
      r = emptyAcc(key, platform, name, status);
      rows.set(key, r);
    }
    return r;
  };

  for (const i of insightsIn(data, f.range, f.platform)) {
    const ad = adIndex.get(`${i.platform}:${i.adId}`);
    if (!matchesParent(ad, ad?.campaignId ?? null)) continue;
    const key = keyFor(i.platform, ad, ad?.campaignId ?? null, i.adId);
    if (!key) continue;
    const r = acc(key, i.platform);
    r.spend += i.spend;
    r.impressions += i.impressions;
    r.clicks += i.clicks;
    r.platformRevenue += i.platformRevenue ?? 0;
  }

  for (const o of ordersIn(data, f.range)) {
    const t = o.touches[f.model];
    if (!t.platform || (f.platform !== "all" && t.platform !== f.platform)) continue;
    const ad = t.adId ? adIndex.get(`${t.platform}:${t.adId}`) : undefined;
    if (!matchesParent(ad, t.campaignId)) continue;
    const key = keyFor(t.platform, ad, t.campaignId, t.adId);
    if (!key) continue;
    const r = acc(key, t.platform);
    r.orders += 1;
    r.revenue += o.revenue;
    if (o.isNew) r.newCustomers += 1;
  }

  return [...rows.values()].map(finish).sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);
}

// ─── Creatives ────────────────────────────────────────────────────────────────

export type FatiguePoint = { week: number; ctr: number | null; roas: number | null; spend: number };

/** CTR and ROAS by week since launch, over all history (not just the range). */
export function fatigue(data: DashboardData, model: Model, platform: Platform, adId: string): FatiguePoint[] {
  const ad = data.ads.find((a) => a.platform === platform && a.id === adId);
  const ins = data.insights.filter((i) => i.platform === platform && i.adId === adId).sort((a, b) => a.date.localeCompare(b.date));
  if (!ins.length) return [];
  const start = ad?.launchedAt ? dayOf(ad.launchedAt) : ins[0].date;
  const weekOf = (day: string) => Math.max(0, Math.floor((Date.parse(day) - Date.parse(start)) / (7 * DAY_MS)));

  const weeks = new Map<number, { imp: number; clicks: number; spend: number; revenue: number }>();
  for (const i of ins) {
    const w = weeks.get(weekOf(i.date)) ?? { imp: 0, clicks: 0, spend: 0, revenue: 0 };
    w.imp += i.impressions;
    w.clicks += i.clicks;
    w.spend += i.spend;
    weeks.set(weekOf(i.date), w);
  }
  for (const o of data.orders) {
    const t = o.touches[model];
    if (o.cancelled || t.platform !== platform || t.adId !== adId) continue;
    const w = weeks.get(weekOf(dayOf(o.createdAt)));
    if (w) w.revenue += o.revenue;
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, w]) => ({ week, ctr: ratio(w.clicks, w.imp), roas: ratio(w.revenue, w.spend), spend: round2(w.spend) }));
}

/** CTR change from an ad's first two weeks to its last two weeks (negative = fatiguing). */
export function ctrDecay(points: FatiguePoint[]): number | null {
  const valid = points.filter((p) => p.ctr !== null);
  if (valid.length < 4) return null;
  const early = avg(valid.slice(0, 2).map((p) => p.ctr as number));
  const late = avg(valid.slice(-2).map((p) => p.ctr as number));
  return delta(late, early);
}

// ─── Journeys ─────────────────────────────────────────────────────────────────

export type PathRow = { path: Channel[]; orders: number; revenue: number };

/** Most common channel paths to purchase; consecutive repeats are collapsed. */
export function topPaths(data: DashboardData, f: Filters, limit = 10): PathRow[] {
  const rows = new Map<string, PathRow>();
  for (const o of creditedTo(ordersIn(data, f.range), f.model, f.platform)) {
    const path = collapse<Channel>(o.path.length ? o.path : ["direct"]);
    const key = path.join(">");
    const r = rows.get(key) ?? { path, orders: 0, revenue: 0 };
    r.orders += 1;
    r.revenue += o.revenue;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.orders - a.orders).slice(0, limit).map((r) => ({ ...r, revenue: round2(r.revenue) }));
}

export type Flow = { from: string; to: string; orders: number };

/** Links for a Sankey: first touch channel → last non-direct channel → "Purchase". */
export function touchFlows(data: DashboardData, f: Filters): Flow[] {
  const links = new Map<string, Flow>();
  const add = (from: string, to: string) => {
    const k = `${from}|${to}`;
    const l = links.get(k) ?? { from, to, orders: 0 };
    l.orders += 1;
    links.set(k, l);
  };
  for (const o of creditedTo(ordersIn(data, f.range), f.model, f.platform)) {
    add(`first:${o.touches.first_touch.channel}`, `last:${o.touches.last_non_direct.channel}`);
  }
  return [...links.values()].sort((a, b) => b.orders - a.orders);
}

export function timeToPurchase(data: DashboardData, f: Filters): { bucket: string; orders: number }[] {
  const buckets = [
    { bucket: "Same day", max: 0 },
    { bucket: "1–3 d", max: 3 },
    { bucket: "4–7 d", max: 7 },
    { bucket: "8–14 d", max: 14 },
    { bucket: "15–30 d", max: 30 },
  ];
  const counts = buckets.map((b) => ({ bucket: b.bucket, orders: 0 }));
  for (const o of creditedTo(ordersIn(data, f.range), f.model, f.platform)) {
    if (o.daysToPurchase === null) continue;
    const i = buckets.findIndex((b) => o.daysToPurchase! <= b.max);
    counts[i === -1 ? counts.length - 1 : i].orders += 1;
  }
  return counts;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sum<T>(xs: T[], f: (x: T) => number): number {
  let t = 0;
  for (const x of xs) t += f(x);
  return t;
}

function avg(xs: number[]): number {
  return xs.length ? sum(xs, (x) => x) / xs.length : 0;
}

function collapse<T>(xs: T[]): T[] {
  return xs.filter((x, i) => i === 0 || x !== xs[i - 1]);
}

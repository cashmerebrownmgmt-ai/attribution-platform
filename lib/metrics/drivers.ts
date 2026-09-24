/**
 * "What's helping / hurting": data-driven breakdowns for any platform, campaign, ad set or ad.
 *
 * 1. ROAS change decomposition. ROAS = CTR × CVR × AOV × 1000 / CPM exactly, so
 *    ln(ROAS₁/ROAS₀) = Σ ln(factor₁/factor₀) (CPM with a minus sign). Each factor's share of the
 *    log change is applied to the actual ROAS change, so the impacts add up to the real change.
 * 2. Peer benchmarks: each factor vs the median of same-platform entities at the same level.
 * 3. Spend response model: log-log least squares on 3-day buckets over the last 60 days,
 *    ln(revenue) = a + b·ln(spend). b is the spend elasticity; marginal ROAS ≈ b × average ROAS.
 * Plus creative fatigue, new-customer mix, platform over-reporting and spend vs revenue share.
 */
import type { Model } from "../attribution";
import { addDays, ctrDecay, dayOf, fatigue, previousRange, ratio, type DateRange, type Filters, type Level } from "./compute";
import type { Ad, DashboardData, Platform, Settings } from "./types";

export type Effect = "helping" | "hurting" | "neutral";
export type Factor = "ctr" | "cvr" | "aov" | "cpm";

export const FACTOR_LABELS: Record<Factor, string> = {
  ctr: "Click-through rate",
  cvr: "Conversion rate",
  aov: "Order value",
  cpm: "Cost per 1,000 impressions",
};

export type Totals = { spend: number; impressions: number; clicks: number; orders: number; revenue: number; newCustomers: number; platformRevenue: number };

export type DriverChange = { factor: Factor; previous: number | null; current: number | null; change: number | null; roasImpact: number; effect: Effect };
export type Benchmark = { factor: Factor | "roas"; value: number | null; peerMedian: number | null; diff: number | null; effect: Effect; peers: number };
export type Finding = { effect: Effect; title: string; detail: string; weight: number };
export type ResponseModel = {
  points: { spend: number; revenue: number }[];
  elasticity: number;
  intercept: number;
  r2: number;
  avgRoas: number | null;
  marginalRoas: number | null;
  confidence: "high" | "medium" | "low";
};

export type Breakdown = {
  key: string;
  level: Level;
  current: Totals;
  previous: Totals;
  roas: { current: number | null; previous: number | null };
  drivers: DriverChange[] | null;
  benchmarks: Benchmark[];
  model: ResponseModel | null;
  findings: Finding[];
};

// ─── Entity selection ─────────────────────────────────────────────────────────

type Matcher = { insight: (platform: Platform, adId: string) => boolean; touch: (platform: Platform | null, campaignId: string | null, adId: string | null) => boolean };

export function matcher(data: DashboardData, level: Level, key: string): Matcher {
  const [platform, id] = key.includes(":") ? (key.split(":") as [Platform, string]) : [key as Platform, ""];
  const ads = new Map(data.ads.map((a) => [`${a.platform}:${a.id}`, a]));
  const adOf = (p: Platform, adId: string | null) => (adId ? ads.get(`${p}:${adId}`) : undefined);
  switch (level) {
    case "platform":
      return { insight: (p) => p === platform, touch: (p) => p === platform };
    case "campaign":
      return {
        insight: (p, adId) => p === platform && adOf(p, adId)?.campaignId === id,
        touch: (p, c, adId) => p === platform && (c ?? adOf(p, adId)?.campaignId) === id,
      };
    case "adGroup":
      return {
        insight: (p, adId) => p === platform && adOf(p, adId)?.adGroupId === id,
        touch: (p, _c, adId) => p === platform && !!p && adOf(p, adId)?.adGroupId === id,
      };
    case "ad":
      return { insight: (p, adId) => p === platform && adId === id, touch: (p, _c, adId) => p === platform && adId === id };
  }
}

export function totals(data: DashboardData, m: Matcher, model: Model, r: DateRange): Totals {
  const t: Totals = { spend: 0, impressions: 0, clicks: 0, orders: 0, revenue: 0, newCustomers: 0, platformRevenue: 0 };
  for (const i of data.insights) {
    if (i.date < r.from || i.date > r.to || !m.insight(i.platform, i.adId)) continue;
    t.spend += i.spend;
    t.impressions += i.impressions;
    t.clicks += i.clicks;
    t.platformRevenue += i.platformRevenue ?? 0;
  }
  for (const o of data.orders) {
    const d = dayOf(o.createdAt);
    const tt = o.touches[model];
    if (o.cancelled || d < r.from || d > r.to || !m.touch(tt.platform, tt.campaignId, tt.adId)) continue;
    t.orders += 1;
    t.revenue += o.revenue;
    if (o.isNew) t.newCustomers += 1;
  }
  return t;
}

export function factors(t: Totals): Record<Factor, number | null> {
  return {
    ctr: ratio(t.clicks, t.impressions),
    cvr: ratio(t.orders, t.clicks),
    aov: ratio(t.revenue, t.orders),
    cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
  };
}

// ─── 1. Decomposition ─────────────────────────────────────────────────────────

const EFFECT_THRESHOLD = 0.03; // ignore impacts under 3% of the starting ROAS

export function decompose(cur: Totals, prev: Totals): DriverChange[] | null {
  const f1 = factors(cur);
  const f0 = factors(prev);
  const roas1 = ratio(cur.revenue, cur.spend);
  const roas0 = ratio(prev.revenue, prev.spend);
  const all = [...Object.values(f1), ...Object.values(f0), roas1, roas0];
  if (all.some((v) => v === null || v <= 0)) return null; // needs orders and spend in both periods

  const logs: Record<Factor, number> = {
    ctr: Math.log(f1.ctr! / f0.ctr!),
    cvr: Math.log(f1.cvr! / f0.cvr!),
    aov: Math.log(f1.aov! / f0.aov!),
    cpm: -Math.log(f1.cpm! / f0.cpm!), // higher CPM lowers ROAS
  };
  const total = Math.log(roas1! / roas0!);
  const dRoas = roas1! - roas0!;
  return (Object.keys(logs) as Factor[]).map((factor) => {
    // Share of the log change, applied to the actual change; when ROAS is flat, use the log-linear approximation.
    const impact = Math.abs(total) > 1e-9 ? dRoas * (logs[factor] / total) : roas0! * logs[factor];
    return {
      factor,
      previous: f0[factor],
      current: f1[factor],
      change: f0[factor] ? f1[factor]! / f0[factor]! - 1 : null,
      roasImpact: impact,
      effect: Math.abs(impact) < EFFECT_THRESHOLD * roas0! ? "neutral" : impact > 0 ? "helping" : "hurting",
    };
  });
}

// ─── 2. Benchmarks ────────────────────────────────────────────────────────────

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function peerKeys(data: DashboardData, level: Level, key: string): string[] {
  const platform = key.split(":")[0];
  switch (level) {
    case "platform":
      return [...new Set(data.insights.map((i) => i.platform))].filter((p) => p !== key);
    case "campaign":
      return data.campaigns.filter((c) => c.platform === platform && `${c.platform}:${c.id}` !== key).map((c) => `${c.platform}:${c.id}`);
    case "adGroup":
      return data.adGroups.filter((g) => g.platform === platform && `${g.platform}:${g.id}` !== key).map((g) => `${g.platform}:${g.id}`);
    case "ad":
      return data.ads.filter((a) => a.platform === platform && `${a.platform}:${a.id}` !== key).map((a) => `${a.platform}:${a.id}`);
  }
}

export function benchmarks(data: DashboardData, level: Level, key: string, model: Model, r: DateRange, self: Totals): Benchmark[] {
  const minSpend = Math.max(50, self.spend * 0.1);
  const peers = peerKeys(data, level, key)
    .map((k) => totals(data, matcher(data, level, k), model, r))
    .filter((t) => t.spend >= minSpend);
  const mine = { ...factors(self), roas: ratio(self.revenue, self.spend) };
  const peerVals = peers.map((t) => ({ ...factors(t), roas: ratio(t.revenue, t.spend) }));
  return (["roas", "ctr", "cvr", "aov", "cpm"] as const).map((factor) => {
    const med = median(peerVals.map((p) => p[factor]).filter((v): v is number => v !== null));
    const value = mine[factor];
    const diff = value !== null && med ? value / med - 1 : null;
    const better = diff === null ? 0 : factor === "cpm" ? -diff : diff;
    return { factor, value, peerMedian: med, diff, effect: diff === null || Math.abs(diff) < 0.1 ? "neutral" : better > 0 ? "helping" : "hurting", peers: peers.length };
  });
}

// ─── 3. Spend response model ──────────────────────────────────────────────────

/** Ordinary least squares y = a + b·x; returns a, b and R². */
export function fitLine(xs: number[], ys: number[]): { a: number; b: number; r2: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy) };
}

export function responseModel(data: DashboardData, m: Matcher, model: Model, end: string, days = 60, bucket = 3): ResponseModel | null {
  // Skip the launch ramp: the first week after an entity starts spending isn't a budget decision.
  const firstSpend = data.insights.reduce<string | null>((min, i) => (i.spend > 0 && m.insight(i.platform, i.adId) && (min === null || i.date < min) ? i.date : min), null);
  if (firstSpend === null) return null;
  const earliest = addDays(firstSpend, 7);

  const points: { spend: number; revenue: number }[] = [];
  for (let startOffset = days - bucket; startOffset >= 0; startOffset -= bucket) {
    const r = { from: addDays(end, -(startOffset + bucket - 1)), to: addDays(end, -startOffset) };
    if (r.from < earliest) continue;
    const t = totals(data, m, model, r);
    if (t.spend > 0) points.push({ spend: t.spend, revenue: t.revenue });
  }
  const usable = points.filter((p) => p.revenue > 0);
  if (usable.length < 8) return null;
  const fit = fitLine(usable.map((p) => Math.log(p.spend)), usable.map((p) => Math.log(p.revenue)));
  if (!fit) return null;
  // Past ~1.1, revenue is rising with spend for other reasons (launches, promos, seasonality), not
  // because each extra dollar earns more; the estimate is kept but never trusted.
  const elasticity = Math.max(0, Math.min(1, fit.b));
  const spend = usable.reduce((s, p) => s + p.spend, 0);
  const revenue = usable.reduce((s, p) => s + p.revenue, 0);
  const avgRoas = ratio(revenue, spend);
  // Spend must actually vary for the slope to mean anything.
  const spread = Math.max(...usable.map((p) => p.spend)) / Math.min(...usable.map((p) => p.spend));
  const confidence = spread < 1.25 || fit.b > 1.1 || fit.b < -0.1 ? "low" : fit.r2 >= 0.5 ? "high" : fit.r2 >= 0.25 ? "medium" : "low";
  return { points, elasticity, intercept: fit.a, r2: fit.r2, avgRoas, marginalRoas: avgRoas === null ? null : elasticity * avgRoas, confidence };
}

// ─── Putting it together ──────────────────────────────────────────────────────

const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;
const x = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}×`);

export function breakdown(data: DashboardData, f: Filters, level: Level, key: string, settings: Pick<Settings, "targetRoas" | "breakevenRoas"> = data.settings): Breakdown {
  const m = matcher(data, level, key);
  const cur = totals(data, m, f.model, f.range);
  const prev = totals(data, m, f.model, previousRange(f.range));
  const drivers = decompose(cur, prev);
  const bench = benchmarks(data, level, key, f.model, f.range, cur);
  const model = level === "platform" || cur.spend > 0 ? responseModel(data, m, f.model, f.range.to) : null;
  const roas = { current: ratio(cur.revenue, cur.spend), previous: ratio(prev.revenue, prev.spend) };
  const findings: Finding[] = [];
  const target = settings.targetRoas ?? 2;
  const breakeven = settings.breakevenRoas ?? 1;

  // Period-over-period drivers
  for (const d of drivers ?? []) {
    if (d.effect === "neutral" || d.change === null) continue;
    const dir = d.change > 0 ? "up" : "down";
    findings.push({
      effect: d.effect,
      title: `${FACTOR_LABELS[d.factor]} ${dir} ${pct(d.change)}`,
      detail: `${d.effect === "helping" ? "Added" : "Cost"} ${Math.abs(d.roasImpact).toFixed(2)}× ROAS vs the previous period.`,
      weight: Math.abs(d.roasImpact) / Math.max(0.1, roas.previous ?? 1),
    });
  }

  // Benchmarks (only factors, ROAS is the outcome)
  for (const b of bench) {
    if (b.factor === "roas" || b.effect === "neutral" || b.diff === null || b.peers < 2) continue;
    const better = b.effect === "helping";
    findings.push({
      effect: b.effect,
      title: `${FACTOR_LABELS[b.factor]} ${better ? "beats" : "trails"} similar ${level === "ad" ? "ads" : level === "adGroup" ? "ad sets" : level === "campaign" ? "campaigns" : "platforms"}`,
      detail: `${pct(b.diff)} ${b.diff > 0 ? "above" : "below"} the median of ${b.peers} on this platform.`,
      weight: Math.min(1, Math.abs(b.diff)) * 0.8,
    });
  }

  // Creative fatigue (ads, and ad sets/campaigns via their biggest ad)
  const adsIn = data.ads.filter((a) => m.insight(a.platform, a.id));
  const fatigued = adsIn
    .map((a: Ad) => ({ ad: a, decay: ctrDecay(fatigue(data, f.model, a.platform, a.id)) }))
    .filter((a) => a.decay !== null && a.decay <= -0.25);
  if (fatigued.length) {
    const worst = fatigued.sort((a, b) => a.decay! - b.decay!)[0];
    findings.push({
      effect: "hurting",
      title: level === "ad" ? "Creative fatigue" : `${fatigued.length} creative${fatigued.length > 1 ? "s" : ""} wearing out`,
      detail: `${level === "ad" ? "Click-through rate" : `“${worst.ad.name}” CTR`} is down ${pct(worst.decay!)} since launch. Fresh creative usually restores it.`,
      weight: Math.abs(worst.decay!),
    });
  }

  // Marginal returns
  if (model && model.confidence !== "low" && model.marginalRoas !== null) {
    const mr = model.marginalRoas;
    findings.push(
      mr >= target
        ? { effect: "helping", title: "Room to scale", detail: `The next dollar is estimated to return ${x(mr)}, above your ${x(target)} target (model fit R² ${model.r2.toFixed(2)}).`, weight: 0.7 }
        : mr < breakeven
          ? { effect: "hurting", title: "Diminishing returns", detail: `Extra spend is estimated to return only ${x(mr)}, below break-even ${x(breakeven)}. Trimming budget should lift overall ROAS.`, weight: 0.7 }
          : { effect: "neutral", title: "Near its efficient spend level", detail: `The next dollar returns about ${x(mr)}: profitable but under target. Hold budget.`, weight: 0.3 },
    );
  }

  // New-customer mix vs account
  const acct = totals(data, { insight: () => true, touch: (p) => p !== null }, f.model, f.range);
  const ncShare = ratio(cur.newCustomers, cur.orders);
  const acctNc = ratio(acct.newCustomers, acct.orders);
  if (ncShare !== null && acctNc !== null && cur.orders >= 10 && Math.abs(ncShare - acctNc) >= 0.15) {
    findings.push({
      effect: ncShare > acctNc ? "helping" : "hurting",
      title: ncShare > acctNc ? "Brings in new customers" : "Mostly repeat buyers",
      detail: `${pct(ncShare)} of its orders are first-time customers vs ${pct(acctNc)} across paid ads.`,
      weight: Math.abs(ncShare - acctNc),
    });
  }

  // Share of platform spend vs share of platform revenue
  if (level !== "platform") {
    const platformKey = key.split(":")[0];
    const plat = totals(data, matcher(data, "platform", platformKey), f.model, f.range);
    const spendShare = ratio(cur.spend, plat.spend);
    const revShare = ratio(cur.revenue, plat.revenue);
    if (spendShare !== null && revShare !== null && spendShare >= 0.05 && Math.abs(spendShare - revShare) >= 0.05) {
      findings.push({
        effect: revShare > spendShare ? "helping" : "hurting",
        title: revShare > spendShare ? "Punches above its budget" : "Takes more budget than it earns",
        detail: `${pct(spendShare)} of this platform's spend, ${pct(revShare)} of its revenue.`,
        weight: Math.abs(spendShare - revShare) * 2,
      });
    }
  }

  // Platform over-reporting
  const overReport = ratio(cur.platformRevenue, cur.revenue);
  if (overReport !== null && overReport >= 1.4 && cur.revenue > 0) {
    findings.push({
      effect: "neutral",
      title: "Platform over-reports",
      detail: `The platform claims ${x(overReport)} the revenue we can verify. Judge it on first-party ROAS (${x(roas.current)}).`,
      weight: 0.2,
    });
  }

  // Outcome vs target (always first if present)
  if (roas.current !== null && cur.spend > 0) {
    findings.push(
      roas.current >= target
        ? { effect: "helping", title: `ROAS ${x(roas.current)} beats target`, detail: `Target is ${x(target)}.`, weight: 2 }
        : roas.current < breakeven
          ? { effect: "hurting", title: `ROAS ${x(roas.current)} is below break-even`, detail: `Break-even is ${x(breakeven)}; every dollar here loses money.`, weight: 2 }
          : { effect: "neutral", title: `ROAS ${x(roas.current)} is under target`, detail: `Profitable (break-even ${x(breakeven)}) but below the ${x(target)} target.`, weight: 1.5 },
    );
  }

  findings.sort((a, b) => b.weight - a.weight);
  return { key, level, current: cur, previous: prev, roas, drivers, benchmarks: bench, model, findings };
}

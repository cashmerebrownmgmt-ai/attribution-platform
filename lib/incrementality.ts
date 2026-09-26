/**
 * Incrementality tests: turn ads off (or cut their budget) for a while and measure how much store
 * revenue actually drops, against what the ad platform claims it drives. Pure.
 *
 * Method: the counterfactual ("what revenue would have been") is the average daily revenue of the
 * baseline weeks before the test, adjusted by day-of-week. Noise is the spread of baseline days
 * around that prediction. Sales from email/SMS visits are left out by default: they swing a lot and
 * don't depend on ad spend, so removing them makes the test more sensitive.
 */
import { addDays, daysIn, spendByDay } from "./metrics/compute";
import { dayOf } from "./metrics/compute";
import type { DashboardData, OrderFact } from "./metrics/types";

export type TestDesign = "pause" | "cut";
export type TestScope = { platform: "meta"; campaignId: string | null };

export type TestPlan = {
  design: TestDesign;
  /** Share of the target's budget removed: 1 for a pause, e.g. 0.5 for a 50% cut. */
  cutShare: number;
  scope: TestScope;
  start: string;
  end: string;
  baselineDays: number;
  excludeEmail: boolean;
};

const Z90 = 1.645; // 90% two-sided interval / 95% one-sided
const Z_POWER = 0.84; // 80% power

const NOISY: ReadonlySet<string> = new Set(["email", "sms"]);

/** The revenue a test measures on a day: all orders, minus email/SMS-driven ones when asked. */
export function outcomeByDay(data: DashboardData, from: string, to: string, excludeEmail: boolean): Map<string, number> {
  const out = new Map(daysIn({ from, to }).map((d) => [d, 0]));
  for (const o of data.orders) {
    if (o.cancelled) continue;
    const d = dayOf(o.createdAt);
    if (!out.has(d)) continue;
    if (excludeEmail && isNoisy(o)) continue;
    out.set(d, (out.get(d) ?? 0) + o.revenue);
  }
  return out;
}

const isNoisy = (o: OrderFact) => NOISY.has(o.touches.last_non_direct.channel);

export type Baseline = { mean: number; weekday: number[]; sd: number; days: number };

/** Day-of-week adjusted baseline from a series of daily values. */
export function fitBaseline(values: { date: string; value: number }[]): Baseline {
  const n = values.length;
  const mean = n ? values.reduce((t, v) => t + v.value, 0) / n : 0;
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  for (const v of values) {
    const w = new Date(`${v.date}T12:00:00Z`).getUTCDay();
    sums[w] += v.value;
    counts[w] += 1;
  }
  // Shrink weekday effects toward 1 when there are few weeks, so one odd day doesn't dominate.
  const weekday = sums.map((s, w) => {
    if (!counts[w] || mean <= 0) return 1;
    const raw = s / counts[w] / mean;
    const weight = counts[w] / (counts[w] + 2);
    return weight * raw + (1 - weight);
  });
  const resid = values.map((v) => v.value - mean * weekday[new Date(`${v.date}T12:00:00Z`).getUTCDay()]);
  const sd = n > 1 ? Math.sqrt(resid.reduce((t, r) => t + r * r, 0) / (n - 1)) : 0;
  return { mean, weekday, sd, days: n };
}

export const expectedOn = (b: Baseline, date: string) => b.mean * b.weekday[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Smallest daily drop a test of `days` can reliably detect (80% power, 95% one-sided). */
export function detectableDrop(b: Baseline, days: number): number {
  if (days <= 0 || b.days <= 0) return Infinity;
  return (Z90 + Z_POWER) * b.sd * Math.sqrt(1 / days + 1 / b.days);
}

export type ScopeStats = { spendPerDay: number; claimedPerDay: number };

/** The target's average daily spend and platform-claimed revenue over a window. */
export function scopeStats(data: DashboardData, scope: TestScope, from: string, to: string): ScopeStats {
  const days = daysIn({ from, to }).length || 1;
  const ins = data.insights.filter((i) => i.platform === scope.platform && i.date >= from && i.date <= to && (!scope.campaignId || data.ads.find((a) => a.platform === i.platform && a.id === i.adId)?.campaignId === scope.campaignId));
  const spend = scope.campaignId ? ins.reduce((t, i) => t + i.spend, 0) : [...spendByDay(data, { from, to }, scope.platform).values()].reduce((t, v) => t + v, 0);
  const claimed = ins.reduce((t, i) => t + (i.platformRevenue ?? 0), 0);
  return { spendPerDay: spend / days, claimedPerDay: claimed / days };
}

export type Recommendation = {
  days: number;
  /** Smallest daily drop the suggested length can reliably detect. */
  detectable: number;
  /** The daily drop the platform's claim implies for this test (claimed revenue × share removed). */
  claimedDrop: number;
  /** The test can detect a drop the size of the platform's claim. */
  feasible: boolean;
  spendAtStake: number;
  baseline: Baseline;
  stats: ScopeStats;
};

/**
 * How long to run: the shortest length (14–42 days) that can detect a drop of 80% of what the
 * platform claims. If the claim holds up, the test shows it; if sales barely move, the result
 * still caps how much of the claim can be real.
 */
export function recommendLength(data: DashboardData, plan: Omit<TestPlan, "end">, asOf: string): Recommendation {
  const baseFrom = addDays(asOf, -plan.baselineDays);
  const baseTo = addDays(asOf, -1);
  const series = [...outcomeByDay(data, baseFrom, baseTo, plan.excludeEmail)].map(([date, value]) => ({ date, value }));
  const baseline = fitBaseline(series);
  const stats = scopeStats(data, plan.scope, baseFrom, baseTo);
  const claimedDrop = stats.claimedPerDay * plan.cutShare;
  let days = 14;
  while (days < 42 && detectableDrop(baseline, days) > 0.8 * claimedDrop) days += 1;
  const detectable = detectableDrop(baseline, days);
  return { days, detectable, claimedDrop, feasible: claimedDrop > 0 && detectable <= claimedDrop, spendAtStake: stats.spendPerDay * plan.cutShare * days, baseline, stats };
}

export type DayResult = { date: string; expected: number; actual: number };

export type Readout = {
  daysMeasured: number;
  daysPlanned: number;
  expected: number;
  actual: number;
  /** Revenue the ads were creating: expected minus actual during the test. */
  lift: number;
  liftLow: number;
  liftHigh: number;
  spendSaved: number;
  claimedDuring: number;
  /** Incremental revenue per dollar: lift ÷ spend removed. */
  incrementalRoas: number | null;
  claimedRoas: number | null;
  /** Share of the platform's claimed revenue that was real: lift ÷ claimed. */
  realShare: number | null;
  significant: boolean;
  verdict: string;
  daily: DayResult[];
};

/**
 * Read out a test. Days after `asOf` (and today, which is incomplete) aren't measured yet.
 * The interval covers both the day-to-day noise during the test and the uncertainty of the baseline.
 */
export function readTest(data: DashboardData, plan: TestPlan, asOf: string): Readout {
  const baseFrom = addDays(plan.start, -plan.baselineDays);
  const baseTo = addDays(plan.start, -1);
  const baseSeries = [...outcomeByDay(data, baseFrom, baseTo, plan.excludeEmail)].map(([date, value]) => ({ date, value }));
  const b = fitBaseline(baseSeries);
  const lastDay = [plan.end, addDays(asOf, -1)].sort()[0];
  const testDays = lastDay >= plan.start ? daysIn({ from: plan.start, to: lastDay }) : [];
  const actualByDay = testDays.length ? outcomeByDay(data, plan.start, lastDay, plan.excludeEmail) : new Map<string, number>();
  const daily = testDays.map((date) => ({ date, expected: expectedOn(b, date), actual: actualByDay.get(date) ?? 0 }));
  const n = daily.length;
  const expected = daily.reduce((t, d) => t + d.expected, 0);
  const actual = daily.reduce((t, d) => t + d.actual, 0);
  const lift = expected - actual;
  const se = b.days > 0 && n > 0 ? b.sd * Math.sqrt(n + (n * n) / b.days) : Infinity;
  const pre = scopeStats(data, plan.scope, baseFrom, baseTo);
  const during = n ? scopeStats(data, plan.scope, plan.start, lastDay) : { spendPerDay: 0, claimedPerDay: 0 };
  const spendSaved = Math.max(0, (pre.spendPerDay - during.spendPerDay) * n);
  const claimedDuring = pre.claimedPerDay * plan.cutShare * n;
  const incrementalRoas = spendSaved > 0 ? lift / spendSaved : null;
  const claimedRoas = pre.spendPerDay > 0 ? pre.claimedPerDay / pre.spendPerDay : null;
  const realShare = claimedDuring > 0 ? lift / claimedDuring : null;
  const significant = n > 0 && lift - Z90 * se > 0;

  const money = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
  let verdict: string;
  if (n === 0) verdict = "The test hasn't started yet.";
  else if (n < 7) verdict = `Only ${n} day${n > 1 ? "s" : ""} measured so far. Early numbers swing a lot; wait for at least a week.`;
  else if (significant && realShare !== null)
    verdict = `The ads were creating about ${money(lift)} in sales over ${n} days (${Math.round(Math.max(0, realShare) * 100)}% of what the platform claimed). ${incrementalRoas !== null ? `Real return: ${incrementalRoas.toFixed(2)}× on the spend removed.` : ""}`.trim();
  else if (lift + Z90 * se < 0.25 * claimedDuring)
    verdict = `Sales barely moved without the ads: they were creating less than a quarter of what the platform claimed. Consider keeping the budget lower and testing new creative.`;
  else {
    const cap = claimedDuring > 0 ? Math.max(0, (lift + Z90 * se) / claimedDuring) : null;
    verdict =
      `No clear drop: the difference is within normal day-to-day swings${n < plan.baselineDays ? "; more days will sharpen this" : ""}.` +
      (cap !== null && cap < 1 ? ` Even at the top of the range, at most ${Math.round(cap * 100)}% of what the platform claimed was real.` : "");
  }

  return {
    daysMeasured: n,
    daysPlanned: daysIn({ from: plan.start, to: plan.end }).length,
    expected,
    actual,
    lift,
    liftLow: lift - Z90 * se,
    liftHigh: lift + Z90 * se,
    spendSaved,
    claimedDuring,
    incrementalRoas,
    claimedRoas,
    realShare,
    significant,
    verdict,
    daily,
  };
}

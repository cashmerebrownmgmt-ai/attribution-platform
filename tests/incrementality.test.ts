import { describe, expect, it } from "vitest";
import { detectableDrop, fitBaseline, outcomeByDay, readTest, recommendLength, type TestPlan } from "@/lib/incrementality";
import { addDays } from "@/lib/metrics/compute";
import type { DashboardData, Insight, OrderFact, Touch } from "@/lib/metrics/types";

const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
const email: Touch = { channel: "email", platform: null, campaignId: null, adId: null };

// Deterministic pseudo-noise so tests are stable.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

let n = 0;
const order = (day: string, revenue: number, t: Touch = direct): OrderFact => ({
  id: `o${++n}`, name: `#${n}`, createdAt: `${day}T16:00:00Z`, revenue, isNew: true, cancelled: false, stitchMethod: "none",
  touches: { first_touch: t, last_touch: t, last_non_direct: t }, path: [], daysToPurchase: null, customerKey: null, items: [],
});

/** 28 baseline days then a 21-day test starting on `start`; `drop` is revenue lost per test day. */
function store(drop: number, seed = 7): { data: DashboardData; plan: TestPlan } {
  const r = rng(seed);
  const start = "2026-09-01";
  const orders: OrderFact[] = [];
  const insights: Insight[] = [];
  for (let i = -28; i < 21; i++) {
    const day = addDays(start, i);
    const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()) ? 60 : 0;
    const testing = i >= 0;
    orders.push(order(day, 300 + weekend + 80 * r() - (testing ? drop : 0)));
    if (i % 5 === 0) orders.push(order(day, 400 * (0.5 + r()), email)); // big, noisy email days
    insights.push({ platform: "meta", adId: "a1", date: day, spend: testing ? 0 : 150, impressions: 1000, clicks: 10, platformConversions: null, platformRevenue: testing ? 0 : 260 });
  }
  const data = {
    mode: "live", generatedAt: "2026-09-25T12:00:00Z",
    settings: { currency: "USD", targetRoas: 2, targetCpa: 25, breakevenRoas: 1.5, lookbackDays: 30, businessName: null },
    orders, campaigns: [], adGroups: [], ads: [{ platform: "meta", id: "a1", adGroupId: "g", campaignId: "c1", name: "A", status: "active", format: "video", headline: null, body: null, thumbnailUrl: null, videoUrl: null, cta: null, landingUrl: null, launchedAt: null }],
    insights, health: { eventsByHour: [], lastEventAt: null, webhooks24h: { total: 0, failed: 0 }, lastWebhookAt: null, stitch7d: {}, pixelCheckouts7d: 0, orders7d: 0 },
  } as DashboardData;
  return { data, plan: { design: "pause", cutShare: 1, scope: { platform: "meta", campaignId: null }, start, end: addDays(start, 20), baselineDays: 28, excludeEmail: true } };
}

describe("baseline", () => {
  it("learns the weekday pattern and the day-to-day noise", () => {
    const values = Array.from({ length: 28 }, (_, i) => {
      const date = addDays("2026-08-03", i);
      return { date, value: [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? 200 : 100 };
    });
    const b = fitBaseline(values);
    expect(b.weekday[0]).toBeGreaterThan(1.3); // Sunday
    expect(b.weekday[3]).toBeLessThan(0.9); // Wednesday
    expect(detectableDrop(b, 28)).toBeLessThan(detectableDrop(b, 7));
  });

  it("leaves email-driven sales out when asked", () => {
    const { data } = store(0);
    const withEmail = [...outcomeByDay(data, "2026-08-04", "2026-08-31", false).values()].reduce((t, v) => t + v, 0);
    const without = [...outcomeByDay(data, "2026-08-04", "2026-08-31", true).values()].reduce((t, v) => t + v, 0);
    expect(withEmail).toBeGreaterThan(without);
  });
});

describe("readTest", () => {
  it("finds a real drop and compares it with the platform's claim", () => {
    const { data, plan } = store(150);
    const r = readTest(data, plan, "2026-09-25");
    expect(r.daysMeasured).toBe(21);
    expect(r.lift / 21).toBeGreaterThan(110);
    expect(r.lift / 21).toBeLessThan(190);
    expect(r.significant).toBe(true);
    expect(r.spendSaved).toBeCloseTo(150 * 21);
    expect(r.claimedRoas).toBeCloseTo(260 / 150);
    expect(r.realShare!).toBeGreaterThan(0.4);
    expect(r.realShare!).toBeLessThan(0.75); // true share is 150/260 ≈ 0.58
    expect(r.liftLow).toBeGreaterThan(0);
    expect(r.verdict).toMatch(/creating about \$/);
  });

  it("doesn't claim an effect that isn't there", () => {
    const { data, plan } = store(0, 11);
    const r = readTest(data, plan, "2026-09-25");
    expect(r.significant).toBe(false);
    expect(r.liftLow).toBeLessThan(0);
    expect(r.verdict).toMatch(/barely moved|No clear drop/);
    if (/No clear drop/.test(r.verdict)) expect(r.verdict).toMatch(/at most \d+% of what the platform claimed/);
  });

  it("measures only finished days and says when it's too early", () => {
    const { data, plan } = store(150);
    expect(readTest(data, plan, "2026-09-01").daysMeasured).toBe(0);
    const early = readTest(data, plan, "2026-09-04");
    expect(early.daysMeasured).toBe(3);
    expect(early.verdict).toMatch(/Only 3 days/);
  });
});

describe("recommendLength", () => {
  it("suggests a length that can detect a plausible drop, longer for noisier stores or smaller cuts", () => {
    const { data } = store(0);
    const pause = recommendLength(data, { design: "pause", cutShare: 1, scope: { platform: "meta", campaignId: null }, start: "2026-09-01", baselineDays: 28, excludeEmail: true }, "2026-09-01");
    expect(pause.stats.spendPerDay).toBeCloseTo(150);
    expect(pause.claimedDrop).toBeCloseTo(260);
    expect(pause.feasible).toBe(true);
    expect(pause.days).toBeGreaterThanOrEqual(14);
    expect(pause.detectable).toBeLessThanOrEqual(0.8 * 260);
    const cut = recommendLength(data, { design: "cut", cutShare: 0.03, scope: { platform: "meta", campaignId: null }, start: "2026-09-01", baselineDays: 28, excludeEmail: true }, "2026-09-01");
    expect(cut.days).toBeGreaterThan(pause.days);
  });
});

import { describe, expect, it } from "vitest";
import { buildDailyReport, localDay, reportDayFor } from "@/lib/daily-report";
import { generateDemo } from "@/lib/demo/generate";
import type { DashboardData, OrderFact, Touch } from "@/lib/metrics/types";

const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
const meta: Touch = { channel: "paid_social", platform: "meta", campaignId: "c1", adId: "a1" };

let n = 0;
const order = (createdAt: string, revenue: number, t: Touch = direct, o: Partial<OrderFact> = {}): OrderFact => ({
  id: `o${++n}`,
  name: `#${n}`,
  createdAt,
  revenue,
  isNew: true,
  cancelled: false,
  stitchMethod: "cart_attribute",
  touches: { first_touch: t, last_touch: t, last_non_direct: t },
  path: [],
  daysToPurchase: 0,
  customerKey: null,
  items: [],
  ...o,
});

function data(orders: OrderFact[], o: Partial<DashboardData> = {}): DashboardData {
  return {
    mode: "live",
    generatedAt: "2026-09-25T13:00:00Z",
    settings: { currency: "USD", targetRoas: 2, targetCpa: 25, breakevenRoas: 1.5, lookbackDays: 30, businessName: null },
    orders,
    campaigns: [],
    adGroups: [],
    ads: [],
    insights: [],
    health: { eventsByHour: [], lastEventAt: "2026-09-25T12:59:00Z", webhooks24h: { total: 3, failed: 0 }, lastWebhookAt: "2026-09-25T12:00:00Z", stitch7d: { cart_attribute: 5 }, pixelCheckouts7d: 5, orders7d: 5 },
    ...o,
  };
}

describe("days in Eastern time", () => {
  it("puts late-evening UTC-next-day orders on the Eastern day", () => {
    expect(localDay("2026-09-25T03:30:00Z")).toBe("2026-09-24"); // 11:30pm EDT
    expect(localDay("2026-09-25T04:30:00Z")).toBe("2026-09-25");
    expect(localDay("2026-12-01T04:30:00Z")).toBe("2026-11-30"); // EST in winter
  });
  it("reports on yesterday, Eastern", () => {
    expect(reportDayFor(Date.parse("2026-09-25T13:00:00Z"))).toBe("2026-09-24");
    expect(reportDayFor(Date.parse("2026-09-25T02:00:00Z"))).toBe("2026-09-23"); // still the 24th in New York
  });
});

describe("buildDailyReport", () => {
  const D = data([
    order("2026-09-24T15:00:00Z", 100, meta), // Thu
    order("2026-09-25T02:00:00Z", 50), // Thu 10pm EDT → still the 24th
    order("2026-09-25T05:00:00Z", 999), // Fri, not in the report
    order("2026-09-24T16:00:00Z", 500, direct, { cancelled: true }),
    order("2026-09-17T15:00:00Z", 100), // last Thursday
    ...["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"].map((d) => order(`${d}T15:00:00Z`, 70)),
  ]);
  const r = buildDailyReport(D, [], "2026-09-24");
  const k = Object.fromEntries(r.kpis.map((x) => [x.key, x]));

  it("computes yesterday against last week and the 7-day average", () => {
    expect(k.revenue).toMatchObject({ value: 150, lastWeek: 100 });
    expect(k.revenue.avg7).toBeCloseTo((100 + 6 * 70) / 7);
    expect(k.orders.value).toBe(2);
    expect(k.aov.value).toBe(75);
    expect(k.sessions).toBeUndefined(); // no session data → no session KPIs
    expect(k.adSpend).toBeUndefined(); // no ad data → no ad KPIs
  });

  it("writes a plain-language summary", () => {
    expect(r.summary[0]).toBe("Thursday, September 24: $150 from 2 orders, up 50% on last Thursday and above your 7-day average by 102%.");
    expect(r.summary.some((s) => s.startsWith("Most revenue came from Paid social"))).toBe(true);
  });

  it("is JSON-serializable, so it can be saved as a snapshot", () => {
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("builds a full report from demo data", () => {
    const demo = generateDemo({ endDay: "2026-09-25" });
    const rep = buildDailyReport(demo, [], "2026-09-24", { now: Date.parse("2026-09-25T13:00:00Z") });
    expect(rep.kpis.map((x) => x.key)).toContain("platformRoas");
    expect(rep.topAds.length).toBeGreaterThan(0);
    expect(rep.products.length).toBeGreaterThan(0);
    expect(rep.actions.every((a) => ["scale", "pause", "refresh"].includes(a.verdict))).toBe(true);
    expect(rep.summary.length).toBeGreaterThanOrEqual(3);
  });
});

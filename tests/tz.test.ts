import { describe, expect, it } from "vitest";
import { dayOf, kpis } from "@/lib/metrics/compute";
import type { DashboardData, OrderFact, Touch } from "@/lib/metrics/types";
import { storeDay } from "@/lib/tz";

describe("store time zone (America/New_York)", () => {
  it("puts evening orders on the Eastern day, like Shopify", () => {
    expect(storeDay("2026-09-25T00:29:00Z")).toBe("2026-09-24"); // 8:29pm EDT
    expect(storeDay("2026-09-25T03:59:59Z")).toBe("2026-09-24");
    expect(storeDay("2026-09-25T04:00:00Z")).toBe("2026-09-25"); // midnight EDT
    expect(storeDay("2026-12-15T04:30:00Z")).toBe("2026-12-14"); // 11:30pm EST (UTC-5)
    expect(storeDay("2026-12-15T05:00:00Z")).toBe("2026-12-15");
  });
  it("handles the daylight-saving switches", () => {
    expect(storeDay("2026-03-08T06:59:00Z")).toBe("2026-03-08"); // 1:59am EST → clocks jump to 3am
    expect(storeDay("2026-11-01T04:30:00Z")).toBe("2026-11-01"); // 12:30am EDT
    expect(storeDay("2026-11-02T04:30:00Z")).toBe("2026-11-01"); // 11:30pm EST
  });
  it("accepts offsets other than Z and passes plain dates through", () => {
    expect(storeDay("2026-09-25T00:29:00+00:00")).toBe("2026-09-24");
    expect(storeDay("2026-09-24T21:00:00-04:00")).toBe("2026-09-24");
    expect(dayOf("2026-09-24")).toBe("2026-09-24");
  });
});

describe("Today's revenue", () => {
  const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
  let n = 0;
  const order = (createdAt: string, revenue: number): OrderFact => ({
    id: `o${++n}`,
    name: `#${n}`,
    createdAt,
    revenue,
    isNew: true,
    cancelled: false,
    stitchMethod: "none",
    touches: { first_touch: direct, last_touch: direct, last_non_direct: direct },
    path: [],
    daysToPurchase: null,
    customerKey: null,
    items: [],
  });
  it("counts only orders placed after midnight Eastern (the $115 vs $22.50 case)", () => {
    const data = {
      orders: [
        order("2026-09-25T00:29:00Z", 7.5),
        order("2026-09-25T02:11:00Z", 69.99),
        order("2026-09-25T02:19:00Z", 7.5),
        order("2026-09-25T02:43:00Z", 7.5),
        order("2026-09-25T04:24:00Z", 0),
        order("2026-09-25T07:14:00Z", 22.5),
      ],
      insights: [],
    } as unknown as DashboardData;
    const k = kpis(data, { model: "last_non_direct", platform: "all" }, { from: "2026-09-25", to: "2026-09-25" });
    expect(k.revenue).toBeCloseTo(22.5);
    expect(k.orders).toBe(2);
  });
});

describe("charts and today's comparison", async () => {
  const { chartRange, compareKpis, hourlyRevenue } = await import("@/lib/metrics/compute");
  const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
  let n = 100;
  const order = (createdAt: string, revenue: number): OrderFact => ({
    id: `o${++n}`, name: `#${n}`, createdAt, revenue, isNew: true, cancelled: false, stitchMethod: "none",
    touches: { first_touch: direct, last_touch: direct, last_non_direct: direct }, path: [], daysToPurchase: null, customerKey: null, items: [],
  });
  const f = { model: "last_non_direct" as const, platform: "all" as const };

  it("gives short ranges two weeks of chart context", () => {
    expect(chartRange({ from: "2026-09-25", to: "2026-09-25" })).toEqual({ from: "2026-09-12", to: "2026-09-25" });
    expect(chartRange({ from: "2026-08-27", to: "2026-09-25" })).toEqual({ from: "2026-08-27", to: "2026-09-25" });
  });

  it("compares today with yesterday up to the same time", () => {
    const now = Date.parse("2026-09-25T16:00:00Z"); // noon Eastern
    const data = {
      orders: [order("2026-09-25T13:00:00Z", 30), order("2026-09-24T13:00:00Z", 20), order("2026-09-24T22:00:00Z", 500)],
      insights: [{ platform: "meta", adId: "a", date: "2026-09-24", spend: 100, impressions: 1000, clicks: 10, platformConversions: 2, platformRevenue: 80 }],
    } as unknown as DashboardData;
    const today = { from: "2026-09-25", to: "2026-09-25" };
    const c = compareKpis(data, { ...f, range: today }, { now });
    expect(c.sameTime).toBe(true);
    expect(c.previous.revenue).toBe(20); // the 6pm order yesterday hasn't "happened" yet at noon
    expect(c.previous.spend).toBeCloseTo(50); // half the day
    const plain = compareKpis(data, { ...f, range: { from: "2026-09-24", to: "2026-09-24" } }, { now });
    expect(plain.sameTime).toBe(false);
    expect(plain.current.revenue).toBe(520);
  });

  it("builds running revenue by Eastern hour, stopping at the current hour", () => {
    const data = { orders: [order("2026-09-25T13:10:00Z", 30), order("2026-09-25T15:30:00Z", 10), order("2026-09-24T05:00:00Z", 7)], insights: [] } as unknown as DashboardData;
    const h = hourlyRevenue(data, f, "2026-09-25", Date.parse("2026-09-25T16:00:00Z"));
    expect(h[8].revenue).toBe(0); // 8am
    expect(h[9].revenue).toBe(30); // 9:10am
    expect(h[11].revenue).toBe(40); // 11:30am
    expect(h[12].revenue).toBe(40); // noon (now)
    expect(h[13].revenue).toBeNull(); // the future
    expect(h[1].previous).toBe(7); // 1am yesterday
  });
});

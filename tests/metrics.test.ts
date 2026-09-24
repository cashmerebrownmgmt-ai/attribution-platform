import { describe, expect, it } from "vitest";
import type { Model } from "@/lib/attribution";
import {
  addDays,
  byChannel,
  compareKpis,
  ctrDecay,
  daily,
  daysIn,
  delta,
  fatigue,
  kpis,
  performance,
  previousRange,
  timeToPurchase,
  topPaths,
  touchFlows,
  type Filters,
} from "@/lib/metrics/compute";
import { platformOf, toTouch } from "@/lib/metrics/touch";
import type { DashboardData, OrderFact, Touch } from "@/lib/metrics/types";

const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
const metaAd: Touch = { channel: "paid_social", platform: "meta", campaignId: "c1", adId: "a1" };
const googleAd: Touch = { channel: "paid_search", platform: "google", campaignId: "c2", adId: "a2" };
const email: Touch = { channel: "email", platform: null, campaignId: null, adId: null };

let n = 0;
function order(day: string, revenue: number, last: Touch, o: Partial<OrderFact> = {}): OrderFact {
  return {
    id: `o${++n}`,
    name: `#${n}`,
    createdAt: `${day}T12:00:00Z`,
    revenue,
    isNew: true,
    cancelled: false,
    stitchMethod: "cart_attribute",
    touches: { first_touch: last, last_touch: last, last_non_direct: last },
    path: [last.channel],
    daysToPurchase: 1,
    ...o,
  };
}

function data(orders: OrderFact[]): DashboardData {
  return {
    mode: "demo",
    generatedAt: "2026-09-10T00:00:00Z",
    settings: { currency: "USD", targetRoas: 2, targetCpa: 30, breakevenRoas: 1.5, lookbackDays: 30, businessName: null },
    orders,
    campaigns: [
      { platform: "meta", id: "c1", name: "Meta prospecting", status: "active", objective: "sales", dailyBudget: 100 },
      { platform: "google", id: "c2", name: "Google search", status: "active", objective: "search", dailyBudget: 50 },
    ],
    adGroups: [
      { platform: "meta", id: "g1", campaignId: "c1", name: "Broad", status: "active", dailyBudget: null },
      { platform: "google", id: "g2", campaignId: "c2", name: "Terms", status: "active", dailyBudget: null },
    ],
    ads: [
      { platform: "meta", id: "a1", adGroupId: "g1", campaignId: "c1", name: "UGC video", status: "active", format: "video", headline: null, body: null, thumbnailUrl: null, videoUrl: null, cta: null, landingUrl: null, launchedAt: "2026-08-01T00:00:00Z" },
      { platform: "google", id: "a2", adGroupId: "g2", campaignId: "c2", name: "RSA", status: "active", format: "text", headline: null, body: null, thumbnailUrl: null, videoUrl: null, cta: null, landingUrl: null, launchedAt: "2026-08-01T00:00:00Z" },
    ],
    insights: [
      { platform: "meta", adId: "a1", date: "2026-09-01", spend: 100, impressions: 10_000, clicks: 100, platformConversions: 3, platformRevenue: 300 },
      { platform: "meta", adId: "a1", date: "2026-09-02", spend: 100, impressions: 10_000, clicks: 50, platformConversions: 1, platformRevenue: 100 },
      { platform: "google", adId: "a2", date: "2026-09-02", spend: 50, impressions: 1_000, clicks: 40, platformConversions: 2, platformRevenue: 150 },
      { platform: "meta", adId: "a1", date: "2026-08-31", spend: 80, impressions: 8_000, clicks: 80, platformConversions: 1, platformRevenue: 80 },
    ],
    health: { eventsByHour: [], lastEventAt: null, webhooks24h: { total: 0, failed: 0 }, lastWebhookAt: null, stitch7d: {}, pixelCheckouts7d: 0, orders7d: 0 },
  };
}

const range = { from: "2026-09-01", to: "2026-09-02" };
const f = (o: Partial<Filters> = {}): Filters => ({ range, model: "last_non_direct", platform: "all", ...o });

const D = data([
  order("2026-09-01", 120, metaAd),
  order("2026-09-02", 80, metaAd, { isNew: false }),
  order("2026-09-02", 200, googleAd),
  order("2026-09-02", 50, email),
  order("2026-09-02", 999, metaAd, { cancelled: true }),
  order("2026-08-31", 60, metaAd), // previous period
]);

describe("dates", () => {
  it("lists days, steps back a period and shifts days", () => {
    expect(daysIn(range)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(previousRange(range)).toEqual({ from: "2026-08-30", to: "2026-08-31" });
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("computes relative change only with a baseline", () => {
    expect(delta(150, 100)).toBe(0.5);
    expect(delta(50, 0)).toBeNull();
    expect(delta(null, 100)).toBeNull();
  });
});

describe("kpis", () => {
  it("computes revenue, spend, ROAS, MER, CPA and platform-reported ROAS", () => {
    const k = kpis(D, f(), range);
    expect(k.revenue).toBe(450); // cancelled order excluded
    expect(k.orders).toBe(4);
    expect(k.aov).toBe(112.5);
    expect(k.spend).toBe(250);
    expect(k.paidRevenue).toBe(400);
    expect(k.paidOrders).toBe(3);
    expect(k.roas).toBe(1.6);
    expect(k.mer).toBe(1.8);
    expect(k.cpa).toBeCloseTo(83.33, 2);
    expect(k.paidNewRevenue).toBe(320);
    expect(k.ncRoas).toBeCloseTo(1.28, 5);
    expect(k.platformRoas).toBe(550 / 250);
    expect(k.ctr).toBeCloseTo(190 / 21_000, 8);
    expect(k.cpm).toBeCloseTo((250 / 21_000) * 1000, 8);
    expect(k.newCustomerShare).toBe(0.75);
  });

  it("scopes spend and credited orders to one platform", () => {
    const k = kpis(D, f({ platform: "meta" }), range);
    expect(k.spend).toBe(200);
    expect(k.orders).toBe(2);
    expect(k.roas).toBe(1);
    expect(k.mer).toBe(1); // platform view: MER uses its own credited revenue
  });

  it("changes credit with the attribution model", () => {
    const o = order("2026-09-01", 100, direct, {
      touches: { first_touch: metaAd, last_touch: direct, last_non_direct: googleAd },
    });
    const d = data([o]);
    const paidBy = (model: Model) => kpis(d, { model, platform: "all" }, range).paidRevenue;
    expect(paidBy("first_touch")).toBe(100);
    expect(paidBy("last_touch")).toBe(0);
    expect(paidBy("last_non_direct")).toBe(100);
  });

  it("returns null ratios when there's no spend or no orders", () => {
    const k = kpis(data([]), f(), { from: "2027-01-01", to: "2027-01-02" });
    expect([k.roas, k.mer, k.cpa, k.aov, k.ctr, k.cpm]).toEqual([null, null, null, null, null, null]);
  });

  it("compares with the previous equal-length period", () => {
    const c = compareKpis(D, f());
    expect(c.previous.revenue).toBe(60);
    expect(c.previous.spend).toBe(80);
  });
});

describe("daily", () => {
  it("fills every day, including empty ones", () => {
    const pts = daily(D, f({ range: { from: "2026-09-01", to: "2026-09-03" } }));
    expect(pts.map((p) => [p.date, p.revenue, p.spend])).toEqual([
      ["2026-09-01", 120, 100],
      ["2026-09-02", 330, 150],
      ["2026-09-03", 0, 0],
    ]);
    expect(pts[2].roas).toBeNull();
  });
});

describe("byChannel", () => {
  it("ranks channels by revenue with shares summing to 1", () => {
    const rows = byChannel(D, f());
    expect(rows.map((r) => r.channel)).toEqual(["paid_social", "paid_search", "email"]);
    expect(rows.reduce((t, r) => t + r.share, 0)).toBeCloseTo(1, 10);
  });
});

describe("performance", () => {
  it("rolls up spend and first-party revenue by platform, campaign and ad", () => {
    const plat = performance(D, f(), "platform");
    expect(plat.find((r) => r.key === "meta")).toMatchObject({ spend: 200, revenue: 200, orders: 2, roas: 1 });
    const camps = performance(D, f(), "campaign");
    expect(camps.map((c) => c.name)).toEqual(["Meta prospecting", "Google search"]);
    expect(camps[1]).toMatchObject({ roas: 4, cpa: 50, platformRoas: 3 });
    const ads = performance(D, f(), "ad", { campaignId: "c1" });
    expect(ads).toHaveLength(1);
    expect(ads[0]).toMatchObject({ key: "meta:a1", name: "UGC video", clicks: 150 });
  });

  it("keeps revenue for ads it doesn't know about", () => {
    const unknown = order("2026-09-01", 40, { channel: "paid_social", platform: "tiktok", campaignId: "tc9", adId: "ta9" });
    const rows = performance(data([unknown]), f(), "ad");
    expect(rows.find((r) => r.key === "tiktok:ta9")).toMatchObject({ name: "Unknown (ta9)", revenue: 40, spend: 0, roas: null });
  });
});

describe("fatigue", () => {
  it("buckets CTR by week since launch and detects decay", () => {
    const pts = fatigue(D, "last_non_direct", "meta", "a1");
    expect(pts.length).toBeGreaterThan(0);
    expect(ctrDecay([{ week: 0, ctr: 0.02, roas: 1, spend: 1 }, { week: 1, ctr: 0.02, roas: 1, spend: 1 }, { week: 2, ctr: 0.01, roas: 1, spend: 1 }, { week: 3, ctr: 0.01, roas: 1, spend: 1 }])).toBe(-0.5);
    expect(ctrDecay(pts.slice(0, 2))).toBeNull();
  });
});

describe("journeys", () => {
  it("collapses repeated channels in paths", () => {
    const o = order("2026-09-01", 10, metaAd, { path: ["paid_social", "paid_social", "email", "email"] });
    expect(topPaths(data([o]), f())[0].path).toEqual(["paid_social", "email"]);
  });
  it("links first touch to last non-direct touch", () => {
    const o = order("2026-09-01", 10, googleAd, { touches: { first_touch: metaAd, last_touch: direct, last_non_direct: googleAd } });
    expect(touchFlows(data([o]), f())).toEqual([{ from: "first:paid_social", to: "last:paid_search", orders: 1 }]);
  });
  it("buckets time to purchase and skips unstitched orders", () => {
    const d = data([
      order("2026-09-01", 10, email, { daysToPurchase: 0 }),
      order("2026-09-01", 10, email, { daysToPurchase: 5 }),
      order("2026-09-01", 10, email, { daysToPurchase: null }),
    ]);
    expect(timeToPurchase(d, f()).map((b) => b.orders)).toEqual([1, 0, 1, 0, 0]);
  });
});

describe("touch mapping", () => {
  it("finds the platform from click IDs first, then utm_source", () => {
    expect(platformOf({ gclid: "g", utm_source: "facebook" })).toBe("google");
    expect(platformOf({ ttclid: "t" })).toBe("tiktok");
    expect(platformOf({ utm_source: "IG" })).toBe("meta");
    expect(platformOf({ fbclid: "f" })).toBe("meta");
    expect(platformOf({ utm_source: "newsletter" })).toBeNull();
  });
  it("uses utm_campaign/utm_content as IDs only for paid traffic", () => {
    expect(toTouch({ utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "123", utm_content: "456" })).toEqual({
      channel: "paid_social", platform: "meta", campaignId: "123", adId: "456",
    });
    expect(toTouch({ utm_source: "instagram", utm_medium: "social", utm_campaign: "bio" })).toEqual({
      channel: "organic_social", platform: null, campaignId: null, adId: null,
    });
    expect(toTouch(null)).toEqual(direct);
  });
});

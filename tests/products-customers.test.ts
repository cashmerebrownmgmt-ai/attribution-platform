import { describe, expect, it } from "vitest";
import { cohorts, customersAcquired, ltvByChannel } from "@/lib/metrics/customers";
import { boughtTogether, productPerformance } from "@/lib/metrics/products";
import type { DashboardData, OrderFact, OrderItem, Touch } from "@/lib/metrics/types";

const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
const metaAd: Touch = { channel: "paid_social", platform: "meta", campaignId: "c1", adId: "a1" };
const email: Touch = { channel: "email", platform: null, campaignId: null, adId: null };

const kit = (key: string, revenue: number, quantity = 1): OrderItem => ({ key, title: key.toUpperCase(), quantity, revenue });

let n = 0;
function order(at: string, revenue: number, touch: Touch, o: Partial<OrderFact> = {}): OrderFact {
  return {
    id: `o${++n}`,
    name: `#${n}`,
    createdAt: at.length === 10 ? `${at}T12:00:00Z` : at,
    revenue,
    isNew: true,
    cancelled: false,
    stitchMethod: "cart_attribute",
    touches: { first_touch: touch, last_touch: touch, last_non_direct: touch },
    path: [touch.channel],
    daysToPurchase: 1,
    customerKey: null,
    items: [],
    ...o,
  };
}

function data(orders: OrderFact[]): DashboardData {
  return {
    mode: "demo",
    generatedAt: "2026-09-10T00:00:00Z",
    settings: { currency: "USD", targetRoas: 2, targetCpa: 30, breakevenRoas: 1.5, lookbackDays: 30, businessName: null },
    orders,
    campaigns: [],
    adGroups: [],
    ads: [],
    insights: [],
    health: { eventsByHour: [], lastEventAt: null, webhooks24h: { total: 0, failed: 0 }, lastWebhookAt: null, stitch7d: {}, pixelCheckouts7d: 0, orders7d: 0 },
  };
}

const range = { from: "2026-09-01", to: "2026-09-09" };

describe("productPerformance", () => {
  const D = data([
    order("2026-09-01", 60, metaAd, { items: [kit("a", 40), kit("b", 20)] }),
    order("2026-09-02", 80, metaAd, { items: [kit("a", 80, 2)], isNew: false }),
    order("2026-09-03", 20, direct, { items: [kit("b", 20)] }),
    order("2026-09-03", 999, direct, { items: [kit("a", 999)], cancelled: true }),
    order("2026-08-01", 50, direct, { items: [kit("b", 50)] }),
  ]);

  it("sums units and revenue per product, excluding cancelled and out-of-range orders", () => {
    const rows = productPerformance(D, range, "last_touch");
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
    const [a, b] = rows;
    expect(a).toMatchObject({ orders: 2, units: 3, revenue: 120, avgPrice: 40, newCustomerShare: 0.5, paidShare: 1, topChannel: "paid_social", topPlatform: "meta" });
    expect(b).toMatchObject({ orders: 2, units: 2, revenue: 40, paidShare: 0.5, topPlatform: "meta" });
    expect(a.share + b.share).toBeCloseTo(1);
    expect(a.share).toBeCloseTo(0.75);
  });

  it("is empty when orders have no line items", () => {
    expect(productPerformance(data([order("2026-09-01", 10, direct)]), range, "last_touch")).toEqual([]);
  });
});

describe("boughtTogether", () => {
  it("counts pairs in 2+ orders with lift against chance", () => {
    const D = data([
      order("2026-09-01", 1, direct, { items: [kit("a", 1), kit("b", 1)] }),
      order("2026-09-02", 1, direct, { items: [kit("b", 1), kit("a", 1), kit("a", 1)] }),
      order("2026-09-03", 1, direct, { items: [kit("c", 1)] }),
      order("2026-09-04", 1, direct, { items: [kit("c", 1)] }),
      order("2026-09-05", 1, direct, { items: [kit("a", 1), kit("c", 1)] }),
    ]);
    const pairs = boughtTogether(D, range);
    expect(pairs).toHaveLength(1); // a+c appears once, so it's left out
    // a in 3 of 5 orders, b in 2 of 5 → expected 1.2 together; seen 2 → lift 1.67
    expect(pairs[0]).toMatchObject({ a: "A", b: "B", orders: 2 });
    expect(pairs[0].lift).toBeCloseTo(2 / 1.2);
  });
});

describe("customer value", () => {
  const asOf = Date.parse("2026-09-10T00:00:00Z");
  const D = data([
    // c1: acquired via Meta in May, buys again 20 days later, then in August.
    order("2026-05-01", 100, metaAd, { customerKey: "c:1" }),
    order("2026-05-21", 50, email, { customerKey: "c:1" }),
    order("2026-08-01", 30, direct, { customerKey: "c:1" }),
    // c2: Meta in May, never again.
    order("2026-05-10", 60, metaAd, { customerKey: "c:2" }),
    // c3: email in June, buys twice in the same month.
    order("2026-06-02", 40, email, { customerKey: "e:x" }),
    order("2026-06-20", 40, email, { customerKey: "e:x" }),
    // c4: acquired last week, too new for the 30/90-day windows.
    order("2026-09-05", 200, metaAd, { customerKey: "c:4" }),
    // Guest with no key and a cancelled order: both ignored.
    order("2026-06-01", 70, direct),
    order("2026-06-01", 70, direct, { customerKey: "c:5", cancelled: true }),
  ]);

  it("groups orders by customer and keeps customers whose first order is in range", () => {
    const cs = customersAcquired(D, "2026-05-01", "2026-06-30");
    expect(cs.map((c) => c.key).sort()).toEqual(["c:1", "c:2", "e:x"]);
    expect(cs.find((c) => c.key === "c:1")?.channel).toBe("paid_social");
  });

  it("computes LTV windows only over customers old enough for them", () => {
    const [all, ...rest] = ltvByChannel(D, "2026-01-01", "2026-09-10", asOf);
    expect(all.customers).toBe(4);
    expect(all.firstOrderValue).toBeCloseTo((100 + 60 + 40 + 200) / 4);
    // 30-day: c1 150, c2 60, c3 80 (c4 too new)
    expect(all.ltv30).toBeCloseTo(290 / 3);
    // 90-day: c1 180 (Aug 1 is day 92 → excluded, so 150), c2 60; c3 isn't 90 days old yet (Jun 2 + 90 = Aug 31 → eligible), 80
    expect(all.ltv90).toBeCloseTo((150 + 60 + 80) / 3);
    expect(all.repeatRate90).toBeCloseTo(2 / 3);
    expect(all.ltvAll).toBeCloseTo((180 + 60 + 80 + 200) / 4);
    const meta = rest.find((r) => r.channel === "paid_social")!;
    expect(meta.customers).toBe(3);
    expect(rest[0].channel).toBe("paid_social"); // most customers first
    expect(all.daysToSecond).toBe(20); // median of [18, 20]
  });

  it("builds monthly cohorts with same-month repeats in month 0", () => {
    const rows = cohorts(D, 6, asOf);
    expect(rows.map((r) => r.month)).toEqual(["2026-05", "2026-06", "2026-09"]);
    const may = rows[0];
    expect(may.customers).toBe(2);
    expect(may.retention[0]).toBeCloseTo(0.5); // c1 bought again on May 21
    expect(may.retention[3]).toBeCloseTo(0.5); // c1 again in August
    expect(may.revenuePerCustomer[0]).toBeCloseTo((150 + 60) / 2);
    expect(may.revenuePerCustomer[3]).toBeCloseTo((180 + 60) / 2);
    expect(rows[1].retention[0]).toBe(1);
    const sep = rows[2];
    expect(sep.retention[0]).toBe(0);
    expect(sep.retention[1]).toBeNull(); // the future
  });
});

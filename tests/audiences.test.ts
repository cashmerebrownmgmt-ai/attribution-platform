import { describe, expect, it } from "vitest";
import { audienceFile, buildAudiences, summarizeCustomers, visitorRecipes } from "@/lib/audiences";
import type { DashboardData, OrderFact, Touch } from "@/lib/metrics/types";
import type { SessionFact } from "@/lib/sessions";

const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
const asOf = Date.parse("2026-09-25T00:00:00Z");
const daysAgo = (d: number) => new Date(asOf - d * 86_400_000).toISOString();
const h = (n: number) => n.toString(16).padStart(64, "0");

let n = 0;
function order(customer: number | null, ago: number, revenue: number, items: string[] = [], o: Partial<OrderFact> = {}): OrderFact {
  return {
    id: `o${++n}`,
    name: `#${n}`,
    createdAt: daysAgo(ago),
    revenue,
    isNew: true,
    cancelled: false,
    stitchMethod: "none",
    touches: { first_touch: direct, last_touch: direct, last_non_direct: direct },
    path: [],
    daysToPurchase: null,
    customerKey: customer === null ? null : `c:${customer}`,
    emailHash: customer === null ? null : h(customer),
    items: items.map((k) => ({ key: k, title: k.toUpperCase(), quantity: 1, revenue: 10 })),
    ...o,
  };
}

function data(orders: OrderFact[]): DashboardData {
  return {
    mode: "demo",
    generatedAt: daysAgo(0),
    settings: { currency: "USD", targetRoas: 2, targetCpa: 30, breakevenRoas: 1.5, lookbackDays: 30, businessName: null },
    orders,
    campaigns: [],
    adGroups: [],
    ads: [],
    insights: [],
    health: { eventsByHour: [], lastEventAt: null, webhooks24h: { total: 0, failed: 0 }, lastWebhookAt: null, stitch7d: {}, pixelCheckouts7d: 0, orders7d: 0 },
  };
}

const byId = (d: DashboardData) => Object.fromEntries(buildAudiences(d, asOf).map((a) => [a.id, a]));

describe("summarizeCustomers", () => {
  it("groups non-cancelled orders by customer and keeps the latest valid email hash", () => {
    const cs = summarizeCustomers(
      data([
        order(1, 100, 20, ["a"], { emailHash: "not-a-hash" }),
        order(1, 10, 30, ["b"]),
        order(1, 5, 999, [], { cancelled: true }),
        order(null, 3, 50),
      ]),
    );
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ orders: 2, spend: 50, emailHash: h(1) });
    expect([...cs[0].products].sort()).toEqual(["a", "b"]);
  });
});

describe("buildAudiences", () => {
  const D = data([
    order(1, 10, 40), // recent
    order(2, 90, 40), // one-time, 90 days → win-back
    order(3, 200, 40), // one-time, too old for win-back
    order(4, 300, 40),
    order(4, 120, 40), // repeat, lapsed
    order(5, 150, 40),
    order(5, 20, 40), // repeat, recent
  ]);
  const a = byId(D);

  it("builds the lifecycle segments", () => {
    expect(a["all-buyers"].customers).toBe(5);
    expect(a["recent-buyers"].hashes).toEqual([h(1), h(5)]);
    expect(a["win-back"].hashes).toEqual([h(2)]);
    expect(a["lapsed-repeat"].hashes).toEqual([h(4)]);
    expect(a["all-buyers"].use).toBe("exclude");
  });

  it("only builds a VIP list with 20+ customers, taking the top 20% by spend", () => {
    expect(a.vip.customers).toBe(0);
    const many = data(Array.from({ length: 30 }, (_, i) => order(100 + i, 50, i + 1)));
    const vip = byId(many).vip;
    expect(vip.customers).toBe(6);
    expect(vip.hashes).toContain(h(129));
    expect(vip.hashes).not.toContain(h(100));
  });

  it("suggests cross-sells for products bought together more than chance", () => {
    const orders = [
      ...Array.from({ length: 8 }, (_, i) => order(200 + i, 30, 20, ["kit", "loops"])),
      ...Array.from({ length: 12 }, (_, i) => order(300 + i, 30, 10, ["kit"])),
      ...Array.from({ length: 20 }, (_, i) => order(400 + i, 30, 10, ["other"])),
    ];
    const cross = buildAudiences(data(orders), asOf).filter((x) => x.id.startsWith("cross-"));
    expect(cross).toHaveLength(1);
    expect(cross[0].name).toBe("Bought KIT, not LOOPS");
    expect(cross[0].customers).toBe(12);
  });
});

describe("audienceFile", () => {
  const a = { id: "x", name: "X", description: "", use: "retarget" as const, angle: "", customers: 2, hashes: [h(1), h(2)] };
  it("writes each platform's upload format", () => {
    expect(audienceFile(a, "meta")).toBe(`email\n${h(1)}\n${h(2)}\n`);
    expect(audienceFile(a, "google")).toBe(`Email\n${h(1)}\n${h(2)}\n`);
    expect(audienceFile(a, "tiktok")).toBe(`${h(1)}\n${h(2)}\n`);
  });
});

describe("visitorRecipes", () => {
  const f = (visitor: string, ago: number, o: Partial<SessionFact>): SessionFact => ({
    session_id: `${visitor}-${ago}`,
    visitor_id: visitor,
    started_at: daysAgo(ago),
    ended_at: daysAgo(ago),
    pageviews: 1,
    landing_path: "/",
    landing_title: null,
    exit_path: "/",
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    msclkid: null,
    referrer: null,
    device: null,
    country: null,
    region: null,
    city: null,
    is_new_visitor: true,
    added_to_cart: false,
    reached_checkout: false,
    completed_checkout: false,
    ...o,
  });
  it("sizes pixel audiences from sessions, leaving out people who later bought", () => {
    const r = Object.fromEntries(
      visitorRecipes(
        [
          f("v1", 2, { reached_checkout: true, added_to_cart: true }),
          f("v2", 3, { reached_checkout: true }),
          f("v2", 1, { completed_checkout: true }), // bought later
          f("v3", 10, { reached_checkout: true, added_to_cart: true }), // too old for 7 days
          f("v4", 20, { pageviews: 4 }),
        ],
        asOf,
      ).map((x) => [x.id, x.people]),
    );
    expect(r).toEqual({ "checkout-abandon": 1, "cart-abandon": 2, "engaged-visitors": 1 });
  });
});

describe("cross-sell variety", () => {
  it("suggests each missing product only once", () => {
    const orders = [
      ...Array.from({ length: 8 }, (_, i) => order(500 + i, 30, 20, ["a", "x"])),
      ...Array.from({ length: 8 }, (_, i) => order(600 + i, 30, 20, ["b", "x"])),
      ...Array.from({ length: 10 }, (_, i) => order(700 + i, 30, 10, ["a"])),
      ...Array.from({ length: 10 }, (_, i) => order(800 + i, 30, 10, ["b"])),
      ...Array.from({ length: 30 }, (_, i) => order(900 + i, 30, 10, ["z"])),
    ];
    const wants = buildAudiences(data(orders), asOf)
      .filter((x) => x.id.startsWith("cross-"))
      .map((x) => x.name.split(", not ")[1]);
    expect(new Set(wants).size).toBe(wants.length);
  });
});

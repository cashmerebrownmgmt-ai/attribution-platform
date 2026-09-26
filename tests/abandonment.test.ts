import { describe, expect, it } from "vitest";
import { buildAbandonment, type PixelStep, type ShopifyAbandoned } from "@/lib/abandonment";
import { abandonedSection, buildDailyReport } from "@/lib/daily-report";
import type { SessionFact } from "@/lib/sessions";

const NOW = Date.parse("2026-09-26T18:00:00Z");
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
let n = 0;
function session(o: Partial<SessionFact> & { minAgo?: number; minutes?: number } = {}): SessionFact {
  const start = o.minAgo ?? 120;
  const { minAgo: _a, minutes: _m, ...rest } = o;
  return {
    session_id: `s${++n}`, visitor_id: `v${n}`, started_at: at(start), ended_at: at(start - (o.minutes ?? 2)), pageviews: 3,
    landing_path: "/", landing_title: null, exit_path: "/", utm_source: null, utm_medium: null, utm_campaign: null,
    gclid: null, fbclid: null, ttclid: null, msclkid: null, referrer: null, device: "mobile", country: "US", region: "GA", city: "Atlanta",
    is_new_visitor: true, added_to_cart: false, reached_checkout: false, completed_checkout: false, landing_host: "cashmerebrown.com",
    ...rest,
  };
}
const px = (visitor: string, type: string, minAgo: number): PixelStep => ({ visitor_id: visitor, type, occurred_at: at(minAgo) });

describe("buildAbandonment", () => {
  const bounce = session({ pageviews: 1, landing_host: "lowendbundle.cashmerebrown.com" });
  const cartOnly = session({ added_to_cart: true, utm_source: "facebook", utm_medium: "paid", fbclid: "F" });
  const checkout = session({ added_to_cart: true, reached_checkout: true, minAgo: 100 });
  const bought = session({ added_to_cart: true, reached_checkout: true, completed_checkout: true });
  const active = session({ added_to_cart: true, minAgo: 10, minutes: 5 }); // last seen 5 min ago
  const pixel = [
    px(checkout.visitor_id, "checkout_started", 97),
    px(checkout.visitor_id, "checkout_contact_info_submitted", 95),
    px(bought.visitor_id, "checkout_started", 117),
    px(bought.visitor_id, "payment_info_submitted", 115),
    px(bought.visitor_id, "checkout_completed", 114),
  ];
  const shopify: ShopifyAbandoned[] = [
    { id: "a1", createdAt: at(96), value: 72.98, currency: "USD", items: ["Art of Noise Complete Bundle"] },
    { id: "a2", createdAt: at(600), value: 15, currency: "USD", items: ["The Soul Reserve Vol. 1"] },
  ];
  const r = buildAbandonment({ sessions: [bounce, cartOnly, checkout, bought, active], pixel, shopify, now: NOW });

  it("counts the funnel with drop-off from each step", () => {
    expect(r.funnel.map((f) => [f.step, f.count])).toEqual([["sessions", 5], ["cart", 4], ["checkout", 2], ["contact", 2], ["shipping", 1], ["payment", 1], ["purchased", 1]]);
    expect(r.funnel[2].fromPrevious).toBeCloseTo(0.5);
  });

  it("lists abandoned visits with how far they got, leaving out buyers and active visitors", () => {
    expect(r.abandonedCarts).toBe(1);
    expect(r.abandonedCheckouts).toBe(1);
    expect(r.stillActive).toBe(1);
    expect(r.rows.map((x) => [x.visitorId, x.furthest])).toEqual([
      [checkout.visitor_id, "contact"],
      [cartOnly.visitor_id, "cart"],
    ]);
    expect(r.rows[1].source).toBe("facebook / paid");
    expect(r.cartAbandonRate).toBeCloseTo(2 / 3);
    expect(r.checkoutAbandonRate).toBeCloseTo(1 / 2);
  });

  it("matches Shopify's abandoned checkouts to visits by time, and keeps unmatched ones", () => {
    expect(r.rows[0].match).toMatchObject({ id: "a1", value: 72.98, certainty: "likely" });
    expect(r.rows[1].match).toBeNull();
    expect(r.shopify.find((s) => s.id === "a2")?.matchedKey).toBeNull();
    expect(r.valueLeft).toBe(87.98);
  });

  it("reports bounce rate overall and by site", () => {
    expect(r.bounceRate).toBeCloseTo(1 / 5);
    expect(r.bounceBySite.find((b) => b.site === "lowendbundle.cashmerebrown.com")).toEqual({ site: "lowendbundle.cashmerebrown.com", sessions: 1, bounceRate: 1 });
    expect(r.bounceBySite.find((b) => b.site === "cashmerebrown.com")?.bounceRate).toBe(0);
  });

  it("handles an empty period", () => {
    const e = buildAbandonment({ sessions: [], pixel: [], shopify: [], now: NOW });
    expect([e.abandonedCarts, e.cartAbandonRate, e.bounceRate, e.valueLeft]).toEqual([0, null, null, 0]);
  });
});

describe("mapAbandoned", async () => {
  const { mapAbandoned } = await import("@/lib/abandonment");
  it("keeps value and product names only, and drops completed checkouts", () => {
    const base = { id: "gid://shopify/AbandonedCheckout/123", createdAt: "2026-09-25T03:45:30Z", completedAt: null, totalPriceSet: { shopMoney: { amount: "72.98", currencyCode: "USD" } }, lineItems: { nodes: [{ title: "The Art Of Noise Complete Bundle", quantity: 1 }, { title: "808 Essentials", quantity: 2 }] } };
    expect(mapAbandoned(base)).toEqual({ id: "123", createdAt: "2026-09-25T03:45:30Z", value: 72.98, currency: "USD", items: ["The Art Of Noise Complete Bundle", "808 Essentials ×2"] });
    expect(mapAbandoned({ ...base, completedAt: "2026-09-25T04:00:00Z" })).toBeNull();
  });
});

describe("daily report section", () => {
  const checkout = session({ added_to_cart: true, reached_checkout: true, minAgo: 100, utm_source: "facebook", utm_medium: "paid", fbclid: "F" });
  const a = buildAbandonment({
    sessions: [checkout, session({ pageviews: 1 })],
    pixel: [px(checkout.visitor_id, "checkout_started", 97)],
    shopify: [
      { id: "a1", createdAt: at(96), value: 72.98, currency: "USD", items: ["Art of Noise Complete Bundle"] },
      { id: "a2", createdAt: at(30), value: 15, currency: "USD", items: ["The Soul Reserve Vol. 1"] },
    ],
    now: NOW,
  });

  it("lists Shopify's checkouts newest first, with the matched visit's source and step", () => {
    const s = abandonedSection(a, true);
    expect(s).toMatchObject({ carts: 0, checkouts: 1, valueLeft: 87.98, currency: "USD" });
    expect(s.list.map((c) => c.value)).toEqual([15, 72.98]);
    expect(s.list[0]).toMatchObject({ source: null, step: null });
    expect(s.list[1].source).toMatch(/facebook/i);
    expect(s.list[1].step).toBe("Started checkout");
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("shows no dollar figure when Shopify couldn't be reached", () => {
    expect(abandonedSection(buildAbandonment({ sessions: [checkout], pixel: [], shopify: [], now: NOW }), false).valueLeft).toBeNull();
  });

  it("adds a summary line to the report", () => {
    const r = buildDailyReport(
      { mode: "live", generatedAt: at(0), settings: { currency: "USD", targetRoas: 2, targetCpa: 25, breakevenRoas: 1.5, lookbackDays: 30, businessName: null }, orders: [], campaigns: [], adGroups: [], ads: [], insights: [], health: { eventsByHour: [], lastEventAt: null, webhooks24h: { total: 0, failed: 0 }, lastWebhookAt: null, stitch7d: {}, pixelCheckouts7d: 0, orders7d: 0 } },
      [],
      "2026-09-25",
      { abandoned: abandonedSection(a, true) },
    );
    expect(r.summary.join(" ")).toContain("1 checkout was abandoned; Shopify shows $88 left in abandoned checkouts.");
    expect(r.abandoned?.list).toHaveLength(2);
  });
});

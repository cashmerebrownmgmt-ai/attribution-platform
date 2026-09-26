import { describe, expect, it } from "vitest";
import { buildAbandonment, type PixelStep, type ShopifyAbandoned } from "@/lib/abandonment";
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

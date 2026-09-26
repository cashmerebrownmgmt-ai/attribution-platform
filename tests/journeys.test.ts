import { describe, expect, it } from "vitest";
import { journeyTouches, mapJourney, syncJourneys, toVisit, visitTouch, type GqlJourneyOrder, type JourneyRow } from "@/lib/journeys";

const NOW = "2026-09-26T12:00:00.000Z";
const visit = (o: Record<string, unknown> = {}) => ({ occurredAt: "2026-09-20T10:00:00Z", landingPage: "https://cashmerebrown.com/", referrerUrl: null, source: "direct", sourceType: null, utmParameters: null, ...o });

describe("toVisit", () => {
  it("keeps UTMs, click IDs, the landing path and the referrer's domain only", () => {
    const v = toVisit(visit({ landingPage: "https://cashmerebrown.com/pages/bundle?utm_source=facebook&gclid=G1&email=me@x.com#top", referrerUrl: "http://m.facebook.com/some/path?x=1", source: "Facebook" }))!;
    expect(v).toEqual({
      at: "2026-09-20T10:00:00Z",
      landingPath: "/pages/bundle",
      referrerHost: "m.facebook.com",
      source: "Facebook",
      sourceType: null,
      utm: { source: "facebook", medium: null, campaign: null, content: null, term: null },
      clickIds: { gclid: "G1", fbclid: null, ttclid: null, msclkid: null },
    });
    expect(JSON.stringify(v)).not.toContain("me@x.com");
  });
  it("handles app referrers and relative landing pages", () => {
    const v = toVisit(visit({ landingPage: "/products/808", referrerUrl: "android-app://com.google.android.gm/" }))!;
    expect(v.landingPath).toBe("/products/808");
    expect(v.referrerHost).toBe("com.google.android.gm");
  });
});

describe("visitTouch", () => {
  const t = (o: Record<string, unknown>) => visitTouch(toVisit(visit(o))!);
  it("credits Meta paid clicks to the exact campaign and ad from the UTMs", () => {
    expect(t({ source: "Facebook", referrerUrl: "http://m.facebook.com/", utmParameters: { source: "facebook", medium: "paid", campaign: "120249246872100342", content: "120249246872090342", term: "120249246872110342" } })).toEqual({
      channel: "paid_social",
      platform: "meta",
      campaignId: "120249246872100342",
      adId: "120249246872090342",
    });
  });
  it("uses Shopify's labels when there are no UTMs", () => {
    expect(t({ utmParameters: { source: "shopify_email", medium: "email", campaign: "c", content: null, term: null } }).channel).toBe("email");
    expect(t({ source: "email", sourceType: "NEWSLETTER" }).channel).toBe("email");
    expect(t({ referrerUrl: "android-app://com.google.android.gm/", sourceType: "NEWSLETTER" }).channel).toBe("email");
    expect(t({ referrerUrl: "https://mail.google.com/" }).channel).toBe("email");
    expect(t({ source: "Google", sourceType: "SEO" }).channel).toBe("organic_search");
    expect(t({ referrerUrl: "https://www.google.com/" }).channel).toBe("organic_search");
    expect(t({ source: "Instagram" }).channel).toBe("organic_social");
    expect(t({ source: "direct" }).channel).toBe("direct");
  });
});

describe("journeyTouches", () => {
  const row = (first: Record<string, unknown> | null, last: Record<string, unknown> | null): Pick<JourneyRow, "first_visit" | "last_visit"> => ({ first_visit: first ? toVisit(visit(first)) : null, last_visit: last ? toVisit(visit(last)) : null });
  const paid = { source: "Facebook", utmParameters: { source: "facebook", medium: "paid", campaign: "c1", content: "a1", term: null } };
  it("maps first and last visits to the models, falling back to the first for last non-direct", () => {
    const tt = journeyTouches(row(paid, { source: "direct" }))!;
    expect(tt.first_touch.adId).toBe("a1");
    expect(tt.last_touch.channel).toBe("direct");
    expect(tt.last_non_direct.adId).toBe("a1");
  });
  it("uses the only visit for everything, and returns null with none", () => {
    const tt = journeyTouches(row(null, paid))!;
    expect([tt.first_touch.adId, tt.last_touch.adId, tt.last_non_direct.adId]).toEqual(["a1", "a1", "a1"]);
    expect(journeyTouches(row(null, null))).toBeNull();
  });
});

describe("syncJourneys", () => {
  it("pages through orders and stores one row per order", async () => {
    const node = (id: string, ready = true): GqlJourneyOrder => ({ legacyResourceId: id, customerJourneySummary: { ready, daysToConversion: 2, momentsCount: { count: 3 }, firstVisit: visit(), lastVisit: visit() } });
    const pages = [
      { orders: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [node("1"), node("2", false)] } },
      { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ legacyResourceId: "3", customerJourneySummary: null }] } },
    ];
    const seen: unknown[] = [];
    const stored: JourneyRow[] = [];
    const r = await syncJourneys(
      { graphql: async (_q, v) => (seen.push(v), pages.shift() as never), store: { upsertJourneys: async (rows) => void stored.push(...rows) }, now: () => new Date(NOW) },
      { since: "2026-09-01" },
    );
    expect(r).toEqual({ orders: 3, withVisits: 2, notReady: 2 });
    expect(seen).toEqual([{ first: 100, after: null, query: "created_at:>=2026-09-01" }, { first: 100, after: "c1", query: "created_at:>=2026-09-01" }]);
    expect(stored[2]).toEqual({ order_id: "3", ready: false, days_to_conversion: null, moments: null, first_visit: null, last_visit: null, fetched_at: NOW });
    expect(mapJourney(node("9"), NOW).moments).toBe(3);
  });
});

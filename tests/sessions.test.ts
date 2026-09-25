import { describe, expect, it } from "vitest";
import { demoSessions } from "@/lib/demo/sessions";
import { breakdown, dimensionValue, formatDuration, sessionKpis, sessionsByDay, sessionsIn, type SessionFact } from "@/lib/sessions";
import { classifyError, parseTotals, sessionsQuery } from "@/lib/shopify-reports";

let n = 0;
function s(o: Partial<SessionFact> = {}): SessionFact {
  return {
    session_id: `s${++n}`, visitor_id: `v${n}`, started_at: "2026-09-20T10:00:00Z", ended_at: "2026-09-20T10:02:00Z", pageviews: 3,
    landing_path: "/", landing_title: null, exit_path: "/cart", utm_source: null, utm_medium: null, utm_campaign: null,
    gclid: null, fbclid: null, ttclid: null, msclkid: null, referrer: null, device: "mobile", country: "US", region: "NY", city: "Brooklyn",
    is_new_visitor: true, added_to_cart: false, reached_checkout: false, completed_checkout: false, ...o,
  };
}

describe("sessionKpis", () => {
  it("computes Shopify-style metrics and funnel", () => {
    const k = sessionKpis([
      s({ added_to_cart: true, reached_checkout: true, completed_checkout: true }),
      s({ added_to_cart: true }),
      s({ pageviews: 1, ended_at: "2026-09-20T10:00:00Z" }),
      s({ visitor_id: "v1", is_new_visitor: false }),
    ]);
    expect(k.sessions).toBe(4);
    expect(k.visitors).toBe(3); // v1 twice
    expect(k.bounceRate).toBe(0.25);
    expect(k.addToCartRate).toBe(0.5);
    expect(k.conversionRate).toBe(0.25);
    expect(k.funnel.map((f) => f.sessions)).toEqual([4, 2, 1, 1]);
    expect(k.pagesPerSession).toBe(2.5);
    expect(k.avgDurationSec).toBe(90);
  });
  it("handles no sessions", () => {
    expect(sessionKpis([]).conversionRate).toBeNull();
  });
});

describe("breakdowns", () => {
  it("groups by dimension with per-group conversion", () => {
    const rows = breakdown([s({ device: "desktop", completed_checkout: true }), s({ device: "desktop" }), s({ device: "mobile" })], "device");
    expect(rows[0]).toMatchObject({ label: "Desktop", sessions: 2, conversionRate: 0.5 });
    expect(rows[1]).toMatchObject({ label: "Mobile", sessions: 1, conversionRate: 0 });
  });
  it("labels sources, referrers and visitor type", () => {
    expect(dimensionValue(s({ gclid: "g" }), "source")).toBe("Google Ads");
    expect(dimensionValue(s({ referrer: "https://www.youtube.com/watch" }), "referrer")).toBe("youtube.com");
    expect(dimensionValue(s(), "referrer")).toBe("(direct / none)");
    expect(dimensionValue(s({ is_new_visitor: false }), "visitorType")).toBe("Returning visitor");
    expect(dimensionValue(s(), "city")).toBe("Brooklyn, NY, US");
  });
  it("fills every day in the range", () => {
    const d = sessionsByDay([s()], { from: "2026-09-19", to: "2026-09-21" });
    expect(d.map((x) => x.sessions)).toEqual([0, 1, 0]);
  });
});

describe("demo sessions", () => {
  it("look like a real store", () => {
    const all = demoSessions("2026-09-24", 30);
    const k = sessionKpis(sessionsIn(all, { from: "2026-09-01", to: "2026-09-24" }));
    expect(k.sessions).toBeGreaterThan(5000);
    expect(k.conversionRate!).toBeGreaterThan(0.01);
    expect(k.conversionRate!).toBeLessThan(0.06);
    expect(k.bounceRate!).toBeGreaterThan(0.3);
  });
});

describe("Shopify comparison", () => {
  it("builds a dated ShopifyQL query and rejects bad dates", () => {
    expect(sessionsQuery({ from: "2026-09-01", to: "2026-09-24" })).toContain("SINCE 2026-09-01 UNTIL 2026-09-24");
    expect(() => sessionsQuery({ from: "x' OR 1", to: "2026-09-24" })).toThrow();
  });
  it("parses object rows, array rows and percentage conversion", () => {
    const cols = ["sessions", "online_store_visitors", "sessions_with_cart_additions", "sessions_that_reached_checkout", "sessions_that_completed_checkout", "conversion_rate"].map((name) => ({ name }));
    expect(parseTotals({ columns: cols, rows: [{ sessions: "120", online_store_visitors: 100, conversion_rate: 2.5 }] })).toMatchObject({ sessions: 120, visitors: 100, conversionRate: 0.025 });
    expect(parseTotals({ columns: cols, rows: [[120, 100, 10, 5, 3, 0.025]] })).toMatchObject({ reachedCheckout: 5, completedCheckout: 3, conversionRate: 0.025 });
    expect(parseTotals({ columns: cols, rows: [] })).toBeNull();
  });
  it("recognizes missing-permission errors", () => {
    expect(classifyError("Access denied for shopifyqlQuery field. Required access: `read_reports` access scope.").status).toBe("no_access");
    expect(classifyError("Shopify GraphQL request failed (502)").status).toBe("error");
  });
});

describe("formatDuration", () => {
  it("formats seconds", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(125)).toBe("2m 05s");
    expect(formatDuration(null)).toBe("—");
  });
});

import { describe, expect, it } from "vitest";
import { deviceFromUA, geoFromHeaders } from "@/lib/collect";
import { demoLiveEvents } from "@/lib/demo/live";
import { liveSummary, locationLabel, sourceLabel, type LiveEvent } from "@/lib/live";

const NOW = Date.parse("2026-09-25T04:10:00Z");
const V = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
let n = 0;
function ev(minAgo: number, o: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: `e${++n}`, visitor_id: V, session_id: S, type: "page_view", source: "tracker",
    occurred_at: new Date(NOW - minAgo * 60_000).toISOString(), path: "/", title: null, referrer: null,
    utm_source: null, utm_medium: null, utm_campaign: null, gclid: null, fbclid: null, ttclid: null, msclkid: null,
    country: "US", region: "NY", city: "Brooklyn", device: "mobile", ...o,
  };
}

describe("liveSummary", () => {
  it("groups a session with its source, pages, location and checkout progress", () => {
    const l = liveSummary(
      [
        ev(4, { utm_source: "test", utm_medium: "check", utm_campaign: "spring", path: "/", title: "Home" }),
        ev(3, { path: "/collections/bundles", title: "Bundles" }),
        ev(2, { session_id: null, source: "pixel", type: "checkout_started", path: "/checkouts/x" }),
        ev(1, { session_id: null, source: "pixel", type: "checkout_shipping_info_submitted", path: "/checkouts/x" }),
      ],
      NOW,
    );
    expect(l.activeNow).toBe(1);
    expect(l.inCheckout).toBe(1);
    const s = l.sessions[0];
    expect(s).toMatchObject({ pageViews: 2, checkout: "shipping", sourceLabel: "test / check", campaign: "spring", landingPath: "/", currentTitle: "Bundles", device: "mobile" });
    expect(locationLabel(s.location)).toBe("Brooklyn, NY, US");
    expect(s.activity[0].label).toBe("Chose shipping");
    expect(l.topLocations).toEqual([{ label: "Brooklyn, NY, US", count: 1 }]);
  });

  it("marks sessions idle after 5 minutes and counts purchases", () => {
    const l = liveSummary([ev(20), ev(19, { session_id: null, source: "pixel", type: "checkout_completed" })], NOW);
    expect(l.activeNow).toBe(0);
    expect(l.purchases).toBe(1);
    expect(l.sessions[0].active).toBe(false);
  });

  it("keeps separate visitors apart and sorts by most recent", () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const l = liveSummary([ev(3), ev(1, { visitor_id: other, session_id: "s2", city: "Toronto", region: "ON", country: "CA" })], NOW);
    expect(l.sessions.map((s) => s.location.city)).toEqual(["Toronto", "Brooklyn"]);
  });

  it("handles unknown location", () => {
    expect(locationLabel({ city: null, region: null, country: null })).toBe("Unknown location");
  });
});

describe("sourceLabel", () => {
  it("names ad clicks, UTMs, referrers and direct", () => {
    expect(sourceLabel({ gclid: "g", utm_source: null, utm_medium: null, referrer: null, fbclid: null, ttclid: null, msclkid: null }).label).toBe("Google Ads");
    expect(sourceLabel({ utm_source: "klaviyo", utm_medium: "email", referrer: null, gclid: null, fbclid: null, ttclid: null, msclkid: null }).label).toBe("klaviyo / email");
    expect(sourceLabel({ referrer: "https://www.google.com/search", utm_source: null, utm_medium: null, gclid: null, fbclid: null, ttclid: null, msclkid: null }).label).toBe("google.com");
    expect(sourceLabel({ referrer: null, utm_source: null, utm_medium: null, gclid: null, fbclid: null, ttclid: null, msclkid: null }).label).toBe("Direct");
  });
});

describe("collect geo and device", () => {
  it("reads Vercel geolocation headers, decoding city names", () => {
    const h = new Headers({ "x-vercel-ip-country": "us", "x-vercel-ip-country-region": "NY", "x-vercel-ip-city": "New%20York" });
    expect(geoFromHeaders(h)).toEqual({ country: "US", region: "NY", city: "New York" });
    expect(geoFromHeaders(new Headers())).toEqual({ country: null, region: null, city: null });
    expect(geoFromHeaders(new Headers({ "x-vercel-ip-country": "ZZZ" })).country).toBeNull();
  });
  it("classifies devices", () => {
    expect(deviceFromUA("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(deviceFromUA("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe("tablet");
    expect(deviceFromUA("Mozilla/5.0 (Linux; Android 14; SM-T970)")).toBe("tablet");
    expect(deviceFromUA("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("mobile");
    expect(deviceFromUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("desktop");
    expect(deviceFromUA(null)).toBeNull();
  });
});

describe("demo live traffic", () => {
  it("produces a believable, changing crowd", () => {
    const a = liveSummary(demoLiveEvents(NOW), NOW);
    expect(a.activeNow).toBeGreaterThan(0);
    expect(a.sessions.length).toBeGreaterThan(a.activeNow);
    expect(demoLiveEvents(NOW).every((e) => Date.parse(e.occurred_at) <= NOW)).toBe(true);
  });
});

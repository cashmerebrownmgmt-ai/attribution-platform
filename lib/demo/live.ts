/**
 * Simulated live traffic for Demo mode: a shifting set of visitors across the last 30 minutes,
 * seeded by the current 10-second window so each refresh moves things along. Pure.
 */
import type { LiveEvent } from "../live";

const CITIES: [string, string, string][] = [
  ["New York", "NY", "US"], ["Los Angeles", "CA", "US"], ["Chicago", "IL", "US"], ["Houston", "TX", "US"],
  ["Atlanta", "GA", "US"], ["Miami", "FL", "US"], ["Brooklyn", "NY", "US"], ["Toronto", "ON", "CA"],
  ["London", "ENG", "GB"], ["Philadelphia", "PA", "US"], ["Dallas", "TX", "US"], ["Seattle", "WA", "US"],
];
const PAGES: [string, string][] = [
  ["/", "Home"], ["/collections/all", "Shop all"], ["/collections/bundles", "Bundles"],
  ["/products/heavyweight-tee", "Heavyweight Tee"], ["/products/boxy-hoodie", "Boxy Hoodie"],
  ["/pages/about", "About us"], ["/cart", "Your cart"], ["/pages/reviews", "Reviews"],
];
const SOURCES: Partial<LiveEvent>[] = [
  { utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "fall_drop", fbclid: "x" },
  { gclid: "g", utm_source: "google", utm_medium: "cpc", utm_campaign: "brand" },
  { referrer: "https://www.google.com/" },
  { utm_source: "tiktok", utm_medium: "paid_social", utm_campaign: "creator_spark", ttclid: "t" },
  { utm_source: "klaviyo", utm_medium: "email", utm_campaign: "weekly_newsletter" },
  {},
  { referrer: "https://l.instagram.com/" },
];
const STEPS = ["checkout_started", "checkout_contact_info_submitted", "checkout_shipping_info_submitted", "payment_info_submitted", "checkout_completed"];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoLiveEvents(now: number): LiveEvent[] {
  const events: LiveEvent[] = [];
  const window10s = Math.floor(now / 10_000);
  // Each visitor is born in a given minute and stays for a few minutes; the seed per visitor is stable.
  for (let v = 0; v < 40; v++) {
    const r = rng(v * 7919 + Math.floor(window10s / 180) * 104729);
    const bornAgoMin = r() * 30;
    const start = now - bornAgoMin * 60_000;
    const [city, region, country] = CITIES[Math.floor(r() * CITIES.length)];
    const src = SOURCES[Math.floor(r() * SOURCES.length)];
    const device = r() < 0.68 ? "mobile" : r() < 0.85 ? "desktop" : "tablet";
    const pageCount = 1 + Math.floor(r() * 6);
    const vid = `00000000-0000-4000-8000-${String(v).padStart(12, "0")}`;
    const sid = `10000000-0000-4000-8000-${String(v).padStart(12, "0")}`;
    let t = start;
    for (let p = 0; p < pageCount; p++) {
      if (t > now) break;
      const [path, title] = p === 0 ? PAGES[Math.floor(r() * 5)] : PAGES[Math.floor(r() * PAGES.length)];
      events.push({
        id: `${vid}-${p}`, visitor_id: vid, session_id: sid, type: "page_view", source: "tracker",
        occurred_at: new Date(t).toISOString(), path, title: `${title} – Cashmere Brown`,
        referrer: p === 0 ? src.referrer ?? null : null,
        utm_source: p === 0 ? src.utm_source ?? null : null, utm_medium: p === 0 ? src.utm_medium ?? null : null,
        utm_campaign: p === 0 ? src.utm_campaign ?? null : null, gclid: p === 0 ? src.gclid ?? null : null,
        fbclid: p === 0 ? src.fbclid ?? null : null, ttclid: p === 0 ? src.ttclid ?? null : null, msclkid: null,
        country, region, city, device,
      });
      t += (20 + r() * 110) * 1000;
    }
    if (r() < 0.22) {
      const reached = 1 + Math.floor(r() * STEPS.length);
      for (let s = 0; s < reached && t <= now; s++) {
        events.push({
          id: `${vid}-c${s}`, visitor_id: vid, session_id: null, type: STEPS[s], source: "pixel",
          occurred_at: new Date(t).toISOString(), path: "/checkouts/cn/demo", title: null, referrer: null,
          utm_source: null, utm_medium: null, utm_campaign: null, gclid: null, fbclid: null, ttclid: null, msclkid: null,
          country, region, city, device,
        });
        t += (25 + r() * 60) * 1000;
      }
    }
  }
  return events.filter((e) => Date.parse(e.occurred_at) <= now);
}

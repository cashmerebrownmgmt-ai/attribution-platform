/** Deterministic demo sessions (~1 order per 38 sessions), for the Sessions page in Demo mode. Pure. */
import type { SessionFact } from "../sessions";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: [T, number][]): T => {
  let x = r() * xs.reduce((t, [, w]) => t + w, 0);
  for (const [v, w] of xs) if ((x -= w) <= 0) return v;
  return xs[0][0];
};

type Src = Partial<SessionFact> & { conv: number };
const SOURCES: [Src, number][] = [
  [{ utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "fall_drop", fbclid: "f", conv: 0.022 }, 22],
  [{ gclid: "g", utm_source: "google", utm_medium: "cpc", utm_campaign: "brand", conv: 0.06 }, 9],
  [{ gclid: "g", utm_source: "google", utm_medium: "cpc", utm_campaign: "drum_kits", conv: 0.03 }, 8],
  [{ utm_source: "tiktok", utm_medium: "paid_social", utm_campaign: "creator_spark", ttclid: "t", conv: 0.011 }, 12],
  [{ referrer: "https://www.google.com/", conv: 0.028 }, 14],
  [{ referrer: "https://www.youtube.com/", conv: 0.034 }, 8],
  [{ referrer: "https://l.instagram.com/", conv: 0.015 }, 7],
  [{ utm_source: "klaviyo", utm_medium: "email", utm_campaign: "weekly_newsletter", conv: 0.05 }, 6],
  [{ conv: 0.035 }, 14],
];
const LANDING: [string, number][] = [["/", 30], ["/collections/drum-kits", 18], ["/collections/sound-kits", 15], ["/products/the-soul-reserve-vol-2", 12], ["/collections/bundles", 10], ["/products/808-essentials", 8], ["/pages/1-on-1", 4]];
const PLACES: [[string, string, string], number][] = [
  [["Atlanta", "GA", "US"], 12], [["Los Angeles", "CA", "US"], 11], [["New York", "NY", "US"], 11], [["Houston", "TX", "US"], 8], [["Chicago", "IL", "US"], 7],
  [["Toronto", "ON", "CA"], 6], [["London", "ENG", "GB"], 6], [["Miami", "FL", "US"], 5], [["Brooklyn", "NY", "US"], 5], [["Lagos", "LA", "NG"], 3], [["Colorado Springs", "CO", "US"], 2],
];

export function demoSessions(endDay: string, days = 200): SessionFact[] {
  const out: SessionFact[] = [];
  const end = Date.parse(`${endDay}T00:00:00Z`);
  const seen = new Set<number>();
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(end - d * 86_400_000);
    const r = rng(Number(day.toISOString().slice(0, 10).replace(/-/g, "")));
    const dow = day.getUTCDay();
    const count = Math.round((520 + 140 * Math.sin((d / 30) * Math.PI)) * (dow === 0 || dow === 6 ? 1.15 : 1) * (0.9 + r() * 0.2));
    for (let i = 0; i < count; i++) {
      const src = pick(r, SOURCES);
      const [city, region, country] = pick(r, PLACES);
      const device = pick(r, [["mobile", 71], ["desktop", 25], ["tablet", 4]] as [string, number][]);
      const visitor = Math.floor(r() * 900_000);
      const isNew = !seen.has(visitor);
      seen.add(visitor);
      const pageviews = r() < 0.47 ? 1 : 2 + Math.floor(r() * 7);
      const start = day.getTime() + Math.floor(r() * 86_400_000);
      const duration = pageviews === 1 ? 0 : (pageviews * (25 + r() * 60)) * 1000;
      const conv = src.conv * (device === "desktop" ? 1.35 : 0.9) * (isNew ? 0.85 : 1.5);
      const completed = pageviews > 1 && r() < conv * 1.05;
      const reached = completed || (pageviews > 1 && r() < conv * 1.4);
      const added = reached || (pageviews > 1 && r() < 0.12);
      const landing = pick(r, LANDING);
      out.push({
        session_id: `${d}-${i}`,
        visitor_id: `v${visitor}`,
        started_at: new Date(start).toISOString(),
        ended_at: new Date(start + duration).toISOString(),
        pageviews,
        landing_path: landing,
        // Some paid-social traffic lands on an off-store landing page (no extra randomness, so the rest of the demo is unchanged).
        landing_host: src.fbclid && i % 3 === 0 ? "lowend-bundle.lovable.app" : "demo-store.example",
        landing_title: null,
        exit_path: completed ? "/checkouts/thank-you" : pageviews === 1 ? landing : pick(r, [["/cart", 3], ["/collections/all", 2], ["/products/808-essentials", 2], ["/", 2]] as [string, number][]),
        utm_source: src.utm_source ?? null,
        utm_medium: src.utm_medium ?? null,
        utm_campaign: src.utm_campaign ?? null,
        gclid: src.gclid ?? null,
        fbclid: src.fbclid ?? null,
        ttclid: src.ttclid ?? null,
        msclkid: null,
        referrer: src.referrer ?? null,
        device,
        country,
        region,
        city,
        is_new_visitor: isNew,
        added_to_cart: added,
        reached_checkout: reached,
        completed_checkout: completed,
      });
    }
  }
  return out;
}

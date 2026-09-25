/** Deterministic demo page stats for the Trend radar: a few products and searches trending up or down. Pure. */
import type { PageStat } from "../trends";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// base sessions/day, daily growth (e.g. 0.03 = +3%/day over the last 30 days), cart rate
type Spec = { key: string; title: string | null; base: number; growth: number; cart: number };
const PRODUCTS: Spec[] = [
  { key: "the-soul-reserve-vol-2", title: "The Soul Reserve Vol. 2 – Cashmere Brown", base: 70, growth: 0, cart: 0.19 },
  { key: "808-essentials", title: "808 Essentials – Cashmere Brown", base: 55, growth: 0, cart: 0.21 },
  { key: "heat-drum-kit", title: "Heat Drum Kit – Cashmere Brown", base: 40, growth: -0.025, cart: 0.18 },
  { key: "late-night-melody-loops", title: "Late Night Melody Loops – Cashmere Brown", base: 18, growth: 0.045, cart: 0.2 },
  { key: "producer-bundle-5-kits", title: "Producer Bundle (5 kits) – Cashmere Brown", base: 35, growth: 0.005, cart: 0.08 },
  { key: "vocal-chops-vol-1", title: "Vocal Chops Vol. 1 – Cashmere Brown", base: 22, growth: 0, cart: 0.17 },
  { key: "1-on-1-mix-session", title: "1-on-1 Mix Session – Cashmere Brown", base: 12, growth: 0.01, cart: 0.12 },
];
const COLLECTIONS: Spec[] = [
  { key: "drum-kits", title: "Drum Kits – Cashmere Brown", base: 90, growth: 0, cart: 0.12 },
  { key: "sound-kits", title: "Sound Kits – Cashmere Brown", base: 75, growth: 0.01, cart: 0.12 },
  { key: "bundles", title: "Bundles – Cashmere Brown", base: 45, growth: 0, cart: 0.09 },
];
const SEARCHES: Spec[] = [
  { key: "808", title: null, base: 9, growth: 0, cart: 0.2 },
  { key: "drum+kit", title: null, base: 7, growth: 0, cart: 0.2 },
  { key: "soul", title: null, base: 5, growth: 0, cart: 0.2 },
  { key: "jersey+club", title: null, base: 1.2, growth: 0.06, cart: 0.05 },
  { key: "rnb+chords", title: null, base: 2.5, growth: 0.02, cart: 0.08 },
  { key: "drill+drums", title: null, base: 3, growth: 0, cart: 0.06 },
  { key: "melody+loops", title: null, base: 2, growth: 0.04, cart: 0.2 },
];

export function demoPageStats(endDay: string, days = 120): PageStat[] {
  const out: PageStat[] = [];
  const end = Date.parse(`${endDay}T00:00:00Z`);
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(end - d * 86_400_000).toISOString().slice(0, 10);
    const r = rng(Number(day.replace(/-/g, "")) + 7);
    const ageFromTrendStart = Math.max(0, 30 - d); // trends play out over the last 30 days
    for (const [kind, specs] of [["product", PRODUCTS], ["collection", COLLECTIONS], ["search", SEARCHES]] as const) {
      for (const s of specs) {
        const mean = s.base * Math.pow(1 + s.growth, ageFromTrendStart) * (0.85 + r() * 0.3);
        const sessions = Math.round(mean);
        if (sessions === 0) continue;
        out.push({ day, kind, key: s.key, title: s.title, views: Math.round(sessions * (1.2 + r() * 0.3)), sessions, carts: Math.round(sessions * s.cart * (0.8 + r() * 0.4)) });
      }
    }
  }
  return out;
}

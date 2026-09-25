/**
 * Trend radar from first-party data: what's picking up or fading on the store, and what visitors
 * ask for that the store doesn't sell. Compares a range with the equally long period before it. Pure.
 */
import type { Tip } from "./behavior-insights";
import type { DateRange } from "./metrics/compute";

export type PageStat = { day: string; kind: "product" | "collection" | "search"; key: string; title: string | null; views: number; sessions: number; carts: number };

export type Mover = {
  key: string;
  label: string;
  current: number;
  previous: number;
  /** Relative change; null when the previous period had none. */
  change: number | null;
  /** Poisson z-score of the change beyond the overall trend: |z| ≥ 2 is unlikely to be noise. */
  z: number;
  status: "new" | "rising" | "falling" | "steady";
};

const PII = /@|\d{7,}/;

/** A readable search term from the raw URL value, or null if it's empty or looks like personal data. */
export function decodeSearch(raw: string): string | null {
  let s = raw.replace(/\+/g, " ");
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep the raw text
  }
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s || s.length > 80 || PII.test(s.replace(/[\s()+.-]/g, ""))) return null;
  return s;
}

/** "808 Essentials – Cashmere Brown" → "808 Essentials". */
export function cleanTitle(title: string | null): string | null {
  if (!title) return null;
  const parts = title.split(/\s+[–|—-]\s+/);
  return (parts.length > 1 ? parts.slice(0, -1).join(" – ") : title).trim() || null;
}

/** "the-soul-reserve-vol-2" → "The Soul Reserve Vol 2" (when the page title is unknown). */
export function handleLabel(handle: string): string {
  return handle
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export type PageTotal = { key: string; label: string; views: number; sessions: number; carts: number };

/** Totals per key for one kind over a range, merging rows whose keys decode to the same term. */
export function totals(stats: PageStat[], kind: PageStat["kind"], r: DateRange): Map<string, PageTotal> {
  const out = new Map<string, PageTotal>();
  for (const s of stats) {
    if (s.kind !== kind || s.day < r.from || s.day > r.to) continue;
    const key = kind === "search" ? decodeSearch(s.key) : s.key;
    if (!key) continue;
    const t = out.get(key) ?? { key, label: kind === "search" ? key : handleLabel(key), views: 0, sessions: 0, carts: 0 };
    const title = cleanTitle(s.title);
    if (title) t.label = title;
    t.views += s.views;
    t.sessions += s.sessions;
    t.carts += s.carts;
    out.set(key, t);
  }
  return out;
}

/**
 * Compare two equally long periods, key by key. Items need `min` in one of the periods to count.
 * `scale` is the overall change (current total ÷ previous total): an item only rises or falls when it
 * moves more than everything else did, so a traffic surge doesn't make every row "rising".
 */
export function movers(current: Map<string, number>, previous: Map<string, number>, labels: Map<string, string> = new Map(), min = 10, scale = 1): Mover[] {
  const keys = new Set([...current.keys(), ...previous.keys()]);
  const out: Mover[] = [];
  for (const key of keys) {
    const c = current.get(key) ?? 0;
    const p = previous.get(key) ?? 0;
    if (Math.max(c, p) < min) continue;
    const variance = c + scale * scale * p;
    const z = variance > 0 ? (c - scale * p) / Math.sqrt(variance) : 0;
    const status: Mover["status"] = p === 0 && c >= min ? "new" : z >= 2 ? "rising" : z <= -2 ? "falling" : "steady";
    out.push({ key, label: labels.get(key) ?? key, current: c, previous: p, change: p > 0 ? c / p - 1 : null, z, status });
  }
  return out.sort((a, b) => b.z - a.z);
}

export const rising = (ms: Mover[]) => ms.filter((m) => m.status === "rising" || m.status === "new");
export const falling = (ms: Mover[]) => ms.filter((m) => m.status === "falling").sort((a, b) => a.z - b.z);

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length >= 3 || /\d/.test(w));

/** Whether any product title or handle contains every meaningful word of the search term. */
export function searchMatches(term: string, catalog: string[]): boolean {
  const ws = words(term);
  if (ws.length === 0) return true; // too short to judge
  const names = catalog.map((c) => ` ${words(c.replace(/-/g, " ")).join(" ")} `);
  return names.some((n) => ws.every((w) => n.includes(` ${w}`)));
}

export type ProductInterest = PageTotal & { cartRate: number | null; typicalCartRate: number | null; z: number | null };

/** Product pages people look at but rarely add to cart, vs the store's other product pages. */
export function lowCartProducts(products: PageTotal[], minSessions = 40): ProductInterest[] {
  const all = products.reduce((t, p) => ({ s: t.s + p.sessions, c: t.c + p.carts }), { s: 0, c: 0 });
  return products
    .map((p) => {
      const os = all.s - p.sessions;
      const oc = all.c - p.carts;
      const rate = p.sessions ? p.carts / p.sessions : null;
      const other = os ? oc / os : null;
      let z: number | null = null;
      if (rate !== null && other !== null && p.sessions >= minSessions && os >= minSessions) {
        const pooled = (p.carts + oc) / (p.sessions + os);
        const se = Math.sqrt(pooled * (1 - pooled) * (1 / p.sessions + 1 / os));
        z = se > 0 ? (rate - other) / se : null;
      }
      return { ...p, cartRate: rate, typicalCartRate: other, z };
    })
    .filter((p) => p.z !== null && p.z <= -2)
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const change = (m: Mover) => (m.change === null ? "new this period" : `${m.change >= 0 ? "+" : ""}${pct(m.change)}`);

/** Plain-language actions from the movers. Impact is a rough orders-per-30-days figure, for ranking. */
export function trendTips(input: {
  products: Mover[];
  searches: Mover[];
  unmatched: Set<string>;
  lowCart: ProductInterest[];
  sources: Mover[];
  days: number;
  conversionRate: number;
}): Tip[] {
  const tips: Tip[] = [];
  const per30 = 30 / Math.max(1, input.days);
  const cr = input.conversionRate || 0.02;

  const hot = rising(input.products)[0];
  if (hot) {
    tips.push({
      id: `trend-product-${hot.key}`,
      area: "trend",
      title: `${hot.label} is picking up: put it in front of more people`,
      why: `Product page sessions went from ${hot.previous} to ${hot.current} (${change(hot)}) compared with the period before. Interest is building on its own, so pushing it now costs less than creating demand later.`,
      actions: [
        `Feature ${hot.label} at the top of the homepage and first in its collections.`,
        "Make 2–3 new ads for it, reusing the hook or angle that's getting clicks now.",
        "Email and text your list about it while interest is rising.",
        "Offer a bundle or an upgrade with it to raise order value.",
      ],
      impact: (hot.current - hot.previous) * per30 * cr * 0.5,
      evidence: `${hot.current} vs ${hot.previous} product-page sessions (z = ${hot.z.toFixed(1)})`,
      tested: true,
    });
  }

  const gaps = rising(input.searches).filter((m) => input.unmatched.has(m.key));
  const topGaps = (gaps.length ? gaps : input.searches.filter((m) => input.unmatched.has(m.key) && m.current >= 10).sort((a, b) => b.current - a.current)).slice(0, 3);
  if (topGaps.length) {
    tips.push({
      id: `trend-search-gap-${topGaps[0].key}`,
      area: "trend",
      title: `Visitors search for "${topGaps[0].key}" and you don't sell it`,
      why: `On-site searches with no matching product: ${topGaps.map((m) => `"${m.key}" (${m.current} searches, ${change(m)})`).join(", ")}. People are telling you what they'd buy.`,
      actions: [
        `Make a kit for "${topGaps[0].key}", or a small pack to test demand before a full release.`,
        "If an existing kit fits, add these words to its title, description and tags so search finds it.",
        "Point the search to a collection or product with Shopify's Search & Discovery app in the meantime.",
      ],
      impact: topGaps.reduce((t, m) => t + m.current, 0) * per30 * cr,
      evidence: `${topGaps.reduce((t, m) => t + m.current, 0)} searches with no matching product`,
      tested: false,
    });
  }

  const weak = input.lowCart[0];
  if (weak && weak.cartRate !== null && weak.typicalCartRate !== null) {
    tips.push({
      id: `trend-lowcart-${weak.key}`,
      area: "landing",
      title: `${weak.label} gets looks but few add-to-carts`,
      why: `${pct(weak.cartRate)} of sessions that view it add something to cart, against ${pct(weak.typicalCartRate)} on your other product pages. Interest is there; something on the page is stopping people.`,
      actions: [
        "Put an audio preview or demo video at the top of the page, above the fold on mobile.",
        "List exactly what's inside (number of sounds, formats, BPM/key labels) and the license terms.",
        "Check the price against similar kits; try a launch discount or a bundle.",
        "Add reviews or artist placements that used it.",
      ],
      impact: weak.sessions * (weak.typicalCartRate - weak.cartRate) * 0.5 * per30 * 0.35,
      evidence: `${weak.carts} of ${weak.sessions} sessions added to cart (z = ${(weak.z ?? 0).toFixed(1)})`,
      tested: true,
    });
  }

  const src = rising(input.sources)[0];
  if (src) {
    tips.push({
      id: `trend-source-${src.key}`,
      area: "channels",
      title: `Traffic from ${src.label} is growing`,
      why: `Sessions from ${src.label} went from ${src.previous} to ${src.current} (${change(src)}). Find out what's driving it so you can do more of it.`,
      actions: [
        `Open the Sessions page filtered to ${src.label} to see which pages they land on.`,
        "If a creator, video or post is sending them, reach out: a code or collab can multiply it.",
        "Make sure the pages they land on have a clear offer and fast audio previews.",
      ],
      impact: (src.current - src.previous) * per30 * cr * 0.3,
      evidence: `${src.current} vs ${src.previous} sessions (z = ${src.z.toFixed(1)})`,
      tested: true,
    });
  }

  const fading = falling(input.products)[0];
  if (fading) {
    tips.push({
      id: `trend-fading-${fading.key}`,
      area: "trend",
      title: `Interest in ${fading.label} is fading`,
      why: `Product page sessions fell from ${fading.previous} to ${fading.current} (${change(fading)}).`,
      actions: [
        "If ads point to it, refresh the creative or move budget to a rising product.",
        "Bundle it with a rising kit rather than promoting it on its own.",
        "Consider a volume 2 or a refresh if it used to be a best seller.",
      ],
      impact: (fading.previous - fading.current) * per30 * cr * 0.2,
      evidence: `${fading.current} vs ${fading.previous} product-page sessions (z = ${fading.z.toFixed(1)})`,
      tested: true,
    });
  }

  return tips.sort((a, b) => b.impact - a.impact);
}

/** Overall change between two periods (current total ÷ previous total), or 1 when there's no baseline. */
export function overallScale(current: Map<string, number>, previous: Map<string, number>): number {
  const sum = (m: Map<string, number>) => [...m.values()].reduce((t, v) => t + v, 0);
  const c = sum(current);
  const p = sum(previous);
  return p > 0 && c > 0 ? c / p : 1;
}

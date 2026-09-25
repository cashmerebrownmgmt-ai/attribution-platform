/**
 * Behavior insights: specific, testable tips from how visitors browse and buy.
 * Every tip needs a minimum sample and a statistically significant gap (two-proportion z-test),
 * and carries an estimate of extra orders per 30 days so tips can be ranked. Pure.
 */
import { breakdown, dimensionValue, sessionKpis, type Dimension, type SessionFact } from "./sessions";

export type Tip = {
  id: string;
  area: "mobile" | "landing" | "cart" | "checkout" | "channels" | "audience" | "geo" | "timing" | "trend";
  title: string;
  why: string;
  actions: string[];
  /** Extra purchases per 30 days if the gap closes halfway (rough, for ranking). */
  impact: number;
  evidence: string;
  /** Whether the gap passed a significance test (vs a threshold rule on a large sample). */
  tested: boolean;
};

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;

/** Two-proportion z-test: is rate a (x1/n1) really different from rate b (x2/n2)? */
export function significant(x1: number, n1: number, x2: number, n2: number, z = 1.96): boolean {
  if (n1 < 1 || n2 < 1) return false;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return false;
  return Math.abs(x1 / n1 - x2 / n2) / se >= z;
}

const conv = (fs: SessionFact[]) => fs.filter((f) => f.completed_checkout).length;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function behaviorTips(cur: SessionFact[], prev: SessionFact[], days: number): Tip[] {
  const tips: Tip[] = [];
  const n = cur.length;
  if (n < 200) return tips; // not enough behavior to learn from yet
  const k = sessionKpis(cur);
  const rate = k.conversionRate ?? 0;
  const per30 = 30 / Math.max(1, days);
  const group = (d: Dimension) => {
    const m = new Map<string, SessionFact[]>();
    for (const f of cur) {
      const key = dimensionValue(f, d);
      const g = m.get(key);
      if (g) g.push(f);
      else m.set(key, [f]);
    }
    return m;
  };

  // 1. Mobile vs desktop
  const byDevice = group("device");
  const mob = byDevice.get("Mobile") ?? [];
  const desk = byDevice.get("Desktop") ?? [];
  if (mob.length >= 150 && desk.length >= 80 && mob.length / n >= 0.4) {
    const mr = conv(mob) / mob.length;
    const dr = conv(desk) / desk.length;
    if (mr < dr * 0.75 && significant(conv(mob), mob.length, conv(desk), desk.length)) {
      tips.push({
        id: "mobile-gap",
        tested: true,
        area: "mobile",
        title: `Phones convert ${Math.round((1 - mr / dr) * 100)}% worse than desktop`,
        why: `${pct(mob.length / n, 0)} of sessions are on phones, but they convert at ${pct(mr, 2)} vs ${pct(dr, 2)} on desktop.`,
        actions: [
          "Open your top product page on a phone: make the audio preview and Add to cart visible without scrolling.",
          "Turn on Shop Pay, Apple Pay and Google Pay so phone buyers skip typing card details.",
          "Keep product descriptions short on mobile; put 'instant download' and what's included right under the price.",
        ],
        impact: mob.length * (dr - mr) * 0.5 * per30,
        evidence: `${mob.length} mobile / ${desk.length} desktop sessions`,
      });
    }
  }

  // 2. Landing pages that lose people
  const byLanding = group("landing");
  for (const b of breakdown(cur, "landing", 12)) {
    if (b.sessions < Math.max(60, n * 0.03) || b.bounceRate === null || k.bounceRate === null) continue;
    const fs = byLanding.get(b.label) ?? [];
    const bounces = fs.filter((f) => f.pageviews <= 1 && !f.added_to_cart && !f.reached_checkout).length;
    const allBounces = Math.round((k.bounceRate ?? 0) * n);
    if (b.bounceRate > k.bounceRate + 0.12 && significant(bounces, fs.length, allBounces - bounces, n - fs.length)) {
      tips.push({
        id: `landing-${b.label}`,
        tested: true,
        area: "landing",
        title: `${b.label} loses ${pct(b.bounceRate, 0)} of visitors on arrival`,
        why: `That's ${Math.round((b.bounceRate - k.bounceRate) * 100)} points worse than your average bounce rate, across ${b.sessions} sessions.`,
        actions: [
          "Check which ads send traffic here and make the page match the ad's promise (same kit, same offer, same visuals).",
          "Put a playable demo and the price above the fold.",
          "If ads point to the homepage, send them to the specific kit or bundle page instead.",
        ],
        impact: fs.length * (b.bounceRate - k.bounceRate) * rate * 0.5 * per30,
        evidence: `${bounces} of ${fs.length} sessions left after one page`,
      });
    }
  }

  // 3. Cart → checkout and 4. checkout → purchase
  const carts = k.funnel[1].sessions;
  const checkouts = k.funnel[2].sessions;
  const bought = k.funnel[3].sessions;
  if (carts >= 40 && checkouts / carts < 0.55) {
    tips.push({
      id: "cart-abandon",
        tested: false,
      area: "cart",
      title: `${pct(1 - checkouts / carts, 0)} of carts never reach checkout`,
      why: `${carts} sessions added to cart but only ${checkouts} started checkout.`,
      actions: [
        "Add a clear Checkout button (and express pay buttons) directly in the cart drawer.",
        "Show 'Instant download after purchase' and your refund/licensing terms on the cart page.",
        "Turn on Shopify's abandoned-checkout email and add a 2-email cart reminder in your email tool.",
      ],
      impact: carts * (0.6 - checkouts / carts) * (bought / Math.max(1, checkouts)) * 0.5 * per30,
      evidence: `${checkouts}/${carts} carts reached checkout`,
    });
  }
  if (checkouts >= 30 && bought / checkouts < 0.5) {
    tips.push({
      id: "checkout-drop",
        tested: false,
      area: "checkout",
      title: `${pct(1 - bought / checkouts, 0)} of checkouts don't finish`,
      why: `${checkouts} sessions reached checkout; ${bought} completed it. For digital products this is usually payment friction or surprise costs.`,
      actions: [
        "Offer express payments (Shop Pay, PayPal, Apple Pay) at the top of checkout.",
        "Remove required fields you don't need for digital goods (phone, shipping address).",
        "Make sure taxes/fees don't surprise buyers at the last step; state prices clearly on the product page.",
      ],
      impact: checkouts * (0.6 - bought / checkouts) * 0.5 * per30,
      evidence: `${bought}/${checkouts} checkouts completed`,
    });
  }

  // 5. Hidden gems and 6. traffic that doesn't buy
  for (const [label, fs] of group("source")) {
    const c = conv(fs);
    const r = c / fs.length;
    const share = fs.length / n;
    if (fs.length >= 60 && share < 0.12 && r >= rate * 1.6 && significant(c, fs.length, conv(cur) - c, n - fs.length)) {
      tips.push({
        id: `gem-${label}`,
        tested: true,
        area: "channels",
        title: `${label} converts ${(r / rate).toFixed(1)}× better than average, but brings only ${pct(share, 0)} of traffic`,
        why: `Visitors from ${label} buy at ${pct(r, 2)} vs ${pct(rate, 2)} overall.`,
        actions: [
          `Put more budget or effort into ${label} (more posts, bigger ad budget, or more collaborations there).`,
          "Look at what those visitors land on and buy, and feature it in other channels too.",
        ],
        impact: fs.length * (r - rate) * 0.5 * per30,
        evidence: `${c} purchases from ${fs.length} sessions`,
      });
    }
    if (share >= 0.15 && fs.length >= 150 && r < rate * 0.5 && significant(c, fs.length, conv(cur) - c, n - fs.length)) {
      tips.push({
        id: `weak-${label}`,
        tested: true,
        area: "channels",
        title: `${label} sends ${pct(share, 0)} of traffic but converts at half your average`,
        why: `${pct(r, 2)} vs ${pct(rate, 2)} overall; that traffic isn't finding what it expected.`,
        actions: [
          "Tighten targeting to producers/beatmakers and exclude broad audiences.",
          "Send these visitors to one specific kit page with a demo, not the homepage.",
          "Test a lower-priced entry product (single kit or free sample) for this source.",
        ],
        impact: fs.length * (rate * 0.8 - r) * 0.5 * per30,
        evidence: `${c} purchases from ${fs.length} sessions`,
      });
    }
  }

  // 7. Returning visitors buy much more → capture emails
  const byType = group("visitorType");
  const nv = byType.get("New visitor") ?? [];
  const rv = byType.get("Returning visitor") ?? [];
  if (nv.length >= 150 && rv.length >= 60) {
    const nr = conv(nv) / nv.length;
    const rr = conv(rv) / rv.length;
    if (rr >= nr * 1.8 && significant(conv(rv), rv.length, conv(nv), nv.length)) {
      tips.push({
        id: "returning",
        tested: true,
        area: "audience",
        title: `Returning visitors buy ${(rr / nr).toFixed(1)}× more than first-timers`,
        why: `${pct(rr, 2)} vs ${pct(nr, 2)}. Most people need a second visit before buying.`,
        actions: [
          "Capture emails on the first visit: offer a free drum kit or sample pack in exchange for an email.",
          "Run a retargeting ad to people who viewed a kit in the last 7 days but didn't buy.",
          "Send a 3-email welcome series showcasing your best-selling kits with audio demos.",
        ],
        impact: nv.length * (nr * 0.25) * per30,
        evidence: `${nv.length} new vs ${rv.length} returning sessions`,
      });
    }
  }

  // 8. Geography
  for (const [label, fs] of group("country")) {
    if (label === "Unknown" || fs.length < 80) continue;
    const c = conv(fs);
    const r = c / fs.length;
    if (fs.length / n >= 0.05 && c === 0 && rate > 0.01) {
      tips.push({
        id: `geo-zero-${label}`,
        tested: false,
        area: "geo",
        title: `${label}: ${fs.length} sessions, no purchases`,
        why: `${pct(fs.length / n, 0)} of your traffic comes from ${label} but none of it has converted in this period.`,
        actions: ["If this traffic is from paid ads, exclude or down-weight this country.", "If it's organic, check pricing/currency display and payment options for that region."],
        impact: fs.length * rate * 0.25 * per30,
        evidence: `0 of ${fs.length} sessions`,
      });
    } else if (fs.length / n >= 0.03 && r >= rate * 1.5 && significant(c, fs.length, conv(cur) - c, n - fs.length)) {
      tips.push({
        id: `geo-${label}`,
        tested: true,
        area: "geo",
        title: `Buyers in ${label} convert ${(r / rate).toFixed(1)}× your average`,
        why: `${pct(r, 2)} vs ${pct(rate, 2)} overall across ${fs.length} sessions.`,
        actions: [`Create a campaign or ad set targeted at ${label} with a higher budget.`, "Reference local artists/scenes from there in your ad creative."],
        impact: fs.length * (r - rate) * 0.3 * per30,
        evidence: `${c} purchases from ${fs.length} sessions`,
      });
    }
  }

  // 9. Best day to sell
  const byDay = new Map<number, SessionFact[]>();
  for (const f of cur) {
    const d = new Date(f.started_at).getUTCDay();
    const g = byDay.get(d);
    if (g) g.push(f);
    else byDay.set(d, [f]);
  }
  const dayRates = [...byDay.entries()].filter(([, fs]) => fs.length >= 60).map(([d, fs]) => ({ d, fs, r: conv(fs) / fs.length }));
  if (dayRates.length >= 5) {
    const best = dayRates.reduce((a, b) => (b.r > a.r ? b : a));
    const worst = dayRates.reduce((a, b) => (b.r < a.r ? b : a));
    if (best.r >= rate * 1.3 && significant(conv(best.fs), best.fs.length, conv(worst.fs), worst.fs.length)) {
      tips.push({
        id: "best-day",
        tested: true,
        area: "timing",
        title: `${DOW[best.d]} is your best day to sell`,
        why: `Visitors convert at ${pct(best.r, 2)} on ${DOW[best.d]}s vs ${pct(worst.r, 2)} on ${DOW[worst.d]}s.`,
        actions: [`Launch new kits and send emails on ${DOW[best.d]}s.`, `Shift a little ad budget toward ${DOW[best.d]} if your platform supports dayparting.`],
        impact: best.fs.length * (best.r - rate) * 0.2 * per30,
        evidence: `${best.fs.length} sessions on ${DOW[best.d]}s`,
      });
    }
  }

  // 10. Trend vs previous period
  if (prev.length >= 200) {
    const pr = conv(prev) / prev.length;
    if (significant(conv(cur), n, conv(prev), prev.length) && Math.abs(rate - pr) / Math.max(pr, 1e-9) >= 0.2) {
      const up = rate > pr;
      tips.push({
        id: "trend",
        tested: true,
        area: "trend",
        title: `Conversion rate ${up ? "up" : "down"} ${Math.round((Math.abs(rate - pr) / pr) * 100)}% vs the previous period`,
        why: `${pct(rate, 2)} now vs ${pct(pr, 2)} before.`,
        actions: up
          ? ["Note what changed (new kit, offer, creative, landing page) and do more of it.", "This is a good moment to raise ad budgets gradually."]
          : ["Check Tracking health first to rule out a tracking problem.", "Look at the source and landing page breakdowns for where the drop is concentrated."],
        impact: up ? 0.01 : n * (pr - rate) * 0.5 * per30,
        evidence: `${n} vs ${prev.length} sessions`,
      });
    }
  }

  return tips.filter((t) => t.impact > 0).sort((a, b) => b.impact - a.impact);
}

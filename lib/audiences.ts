/**
 * Retargeting audiences from first-party order data: customer lists to upload to Meta, Google and
 * TikTok (as SHA-256 email hashes, which is what they match on), plus site-visitor recipes to build
 * with the platforms' own pixels. The platform never uploads anything itself. Pure.
 */
import type { DashboardData } from "./metrics/types";
import type { SessionFact } from "./sessions";

const DAY = 86_400_000;
const HASH = /^[0-9a-f]{64}$/;

export type AudiencePlatform = "meta" | "google" | "tiktok";

/** Smallest list each platform will run ads to, in matched people. */
export const MIN_SIZE: Record<AudiencePlatform, number> = { meta: 100, google: 100, tiktok: 1000 };

export type CustomerSummary = {
  key: string;
  emailHash: string | null;
  firstAt: number;
  lastAt: number;
  orders: number;
  spend: number;
  products: Set<string>;
};

export type Audience = {
  id: string;
  name: string;
  description: string;
  /** How to use it: exclude from ads, or retarget with a specific angle. */
  use: "exclude" | "retarget";
  angle: string;
  customers: number;
  /** Email hashes, one per customer who has one. */
  hashes: string[];
};

export function summarizeCustomers(data: DashboardData): CustomerSummary[] {
  const by = new Map<string, CustomerSummary>();
  for (const o of data.orders) {
    if (o.cancelled || !o.customerKey) continue;
    const at = Date.parse(o.createdAt);
    const c = by.get(o.customerKey) ?? { key: o.customerKey, emailHash: null, firstAt: at, lastAt: at, orders: 0, spend: 0, products: new Set<string>() };
    c.orders += 1;
    c.spend += o.revenue;
    if (at < c.firstAt) c.firstAt = at;
    if (at >= c.lastAt) {
      c.lastAt = at;
      if (o.emailHash && HASH.test(o.emailHash)) c.emailHash = o.emailHash; // the latest email wins
    }
    if (!c.emailHash && o.emailHash && HASH.test(o.emailHash)) c.emailHash = o.emailHash;
    for (const i of o.items) c.products.add(i.key);
    by.set(o.customerKey, c);
  }
  return [...by.values()];
}

function audience(a: Omit<Audience, "customers" | "hashes">, members: CustomerSummary[]): Audience {
  const hashes = [...new Set(members.map((m) => m.emailHash).filter((h): h is string => !!h))].sort();
  return { ...a, customers: members.length, hashes };
}

/** Product pairs often bought together, as "bought A, not yet B" cross-sell audiences. */
function crossSell(customers: CustomerSummary[], titles: Map<string, string>, limit: number): Audience[] {
  const single = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const c of customers) {
    const keys = [...c.products].sort();
    for (const k of keys) single.set(k, (single.get(k) ?? 0) + 1);
    for (let x = 0; x < keys.length; x++) for (let y = x + 1; y < keys.length; y++) pairs.set(`${keys[x]}\n${keys[y]}`, (pairs.get(`${keys[x]}\n${keys[y]}`) ?? 0) + 1);
  }
  const n = Math.max(1, customers.length);
  const ranked = [...pairs.entries()]
    .filter(([, both]) => both >= 5)
    .map(([k, both]) => {
      const [a, b] = k.split("\n");
      const lift = both / (((single.get(a) ?? 0) * (single.get(b) ?? 0)) / n);
      return { a, b, both, lift };
    })
    .filter((p) => p.lift > 1.1)
    .sort((p, q) => q.lift * Math.log(q.both) - p.lift * Math.log(p.both));

  const out: Audience[] = [];
  const suggested = new Set<string>();
  for (const p of ranked) {
    if (out.length >= limit) break;
    // Target owners of the more popular product with the one they're missing; suggest each product once.
    const [have, want] = (single.get(p.a) ?? 0) >= (single.get(p.b) ?? 0) ? [p.a, p.b] : [p.b, p.a];
    if (suggested.has(want)) continue;
    suggested.add(want);
    const haveT = titles.get(have) ?? have;
    const wantT = titles.get(want) ?? want;
    out.push(
      audience(
        {
          id: `cross-${have}-${want}`.replace(/[^a-zA-Z0-9-]/g, "_"),
          name: `Bought ${haveT}, not ${wantT}`,
          description: `Customers who own ${haveT} but not ${wantT}. People who buy both are ${p.lift.toFixed(1)}× more common than chance.`,
          use: "retarget",
          angle: `"Loved ${haveT}? ${wantT} is the missing piece": show them together, with a bundle price or a code for owners.`,
        },
        customers.filter((c) => c.products.has(have) && !c.products.has(want)),
      ),
    );
  }
  return out;
}

export function buildAudiences(data: DashboardData, asOf: number): Audience[] {
  const customers = summarizeCustomers(data);
  const ago = (c: CustomerSummary, field: "firstAt" | "lastAt") => (asOf - c[field]) / DAY;
  const titles = new Map(data.orders.flatMap((o) => o.items.map((i) => [i.key, i.title] as const)));

  const bySpend = [...customers].sort((a, b) => b.spend - a.spend);
  const vip = customers.length >= 20 ? bySpend.slice(0, Math.ceil(customers.length * 0.2)) : [];

  return [
    audience(
      {
        id: "all-buyers",
        name: "All customers",
        description: "Everyone who has bought from you.",
        use: "exclude",
        angle: "Exclude from prospecting campaigns so new-customer budget isn't spent on people you already have. Also the best seed for a 1% lookalike.",
      },
      customers,
    ),
    audience(
      {
        id: "recent-buyers",
        name: "Bought in the last 30 days",
        description: "Customers whose latest order was in the last 30 days.",
        use: "exclude",
        angle: "Exclude from retargeting and discount ads: they just bought, and discounts now teach them to wait.",
      },
      customers.filter((c) => ago(c, "lastAt") <= 30),
    ),
    audience(
      {
        id: "win-back",
        name: "One-time buyers, 60–180 days ago",
        description: "Bought once, 2 to 6 months ago, and haven't been back.",
        use: "retarget",
        angle: "What's new since they bought: the latest kits, a \"new drop\" angle, and a returning-customer code.",
      },
      customers.filter((c) => c.orders === 1 && ago(c, "firstAt") >= 60 && ago(c, "firstAt") <= 180),
    ),
    audience(
      {
        id: "lapsed-repeat",
        name: "Lapsed repeat customers",
        description: "Bought 2+ times, but nothing in the last 90 days.",
        use: "retarget",
        angle: "They already trust you: show the newest release or an early-access offer, not a generic ad.",
      },
      customers.filter((c) => c.orders >= 2 && ago(c, "lastAt") > 90),
    ),
    audience(
      {
        id: "vip",
        name: "Top 20% by spend",
        description: "Your highest-spending customers.",
        use: "retarget",
        angle: "Seed a lookalike audience from these (value-based if the platform offers it). Offer them early access, bundles and 1-on-1s.",
      },
      vip,
    ),
    ...crossSell(customers, titles, 3),
  ];
}

/** File contents for each platform's customer-list upload, using pre-hashed emails. */
export function audienceFile(a: Audience, platform: AudiencePlatform): string {
  switch (platform) {
    case "meta":
      return ["email", ...a.hashes].join("\n") + "\n"; // Meta: choose "email" when mapping; hashed values are detected
    case "google":
      return ["Email", ...a.hashes].join("\n") + "\n"; // Google Customer Match: "Email" column, SHA-256 accepted
    case "tiktok":
      return a.hashes.join("\n") + "\n"; // TikTok: one hash per line, upload as "Email SHA256"
  }
}

export type VisitorRecipe = { id: string; name: string; people: number; window: string; how: Record<AudiencePlatform, string>; angle: string };

/** Site-visitor audiences to build with each platform's pixel (no emails needed), sized from our own sessions. */
export function visitorRecipes(facts: SessionFact[], asOf: number): VisitorRecipe[] {
  const within = (days: number) => facts.filter((f) => asOf - Date.parse(f.started_at) <= days * DAY);
  const buyers = new Set(within(30).filter((f) => f.completed_checkout).map((f) => f.visitor_id));
  const count = (fs: SessionFact[], pred: (f: SessionFact) => boolean) => new Set(fs.filter((f) => pred(f) && !buyers.has(f.visitor_id)).map((f) => f.visitor_id)).size;

  return [
    {
      id: "checkout-abandon",
      name: "Started checkout, didn't buy",
      people: count(within(7), (f) => f.reached_checkout),
      window: "7 days",
      how: {
        meta: "Audiences → Create → Custom audience → Website → InitiateCheckout in the last 7 days, exclude Purchase in the last 7 days.",
        google: "Audience manager → Segments → Website visitors: visited checkout pages (URL contains /checkouts) but not the thank-you page, 7 days.",
        tiktok: "Audiences → Create → Website traffic → event: Initiate Checkout, 7 days, exclude Complete Payment.",
      },
      angle: "Closest to buying: remind them what's in the kit, answer the license question, and show reviews. A small code only if they don't return in 3 days.",
    },
    {
      id: "cart-abandon",
      name: "Added to cart, didn't buy",
      people: count(within(14), (f) => f.added_to_cart && !f.completed_checkout),
      window: "14 days",
      how: {
        meta: "Custom audience → Website → AddToCart in the last 14 days, exclude Purchase in the last 14 days.",
        google: "Website visitors who viewed /cart in the last 14 days, excluding purchasers.",
        tiktok: "Website traffic → event: Add to Cart, 14 days, exclude Complete Payment.",
      },
      angle: "Show the exact kit (dynamic/catalog ads if you have a product feed) with an audio demo in the first 2 seconds.",
    },
    {
      id: "engaged-visitors",
      name: "Engaged visitors, no purchase",
      people: count(within(30), (f) => f.pageviews >= 3 && !f.completed_checkout),
      window: "30 days",
      how: {
        meta: "Custom audience → Website → people by time spent: top 25% in the last 30 days, exclude Purchase.",
        google: "Website visitors with 3+ page views in 30 days (or GA4 engaged sessions), excluding purchasers.",
        tiktok: "Website traffic → visitors by time spent, top 25%, 30 days, exclude Complete Payment.",
      },
      angle: "They browsed but weren't sold: lead with social proof (artist placements, before/after beats) and your best seller.",
    },
  ];
}

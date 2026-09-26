/**
 * Abandoned carts and checkouts, and bounce rate, for the Live page's "Abandoned" tab. Pure.
 *
 * A visit is abandoned when it added to cart or reached checkout, didn't purchase, and has been idle
 * for `idleMs` (default 30 minutes). Checkout steps come from the checkout pixel's events for the
 * visitor. Shopify's own abandoned-checkout list (value and products) is matched to visits by time,
 * since Shopify's abandoned-checkout ID differs from the one the pixel sees; matches are "likely".
 */
import { dimensionValue, sessionKpis, type SessionFact } from "./sessions";

export type PixelStep = { visitor_id: string; type: string; occurred_at: string };
export type ShopifyAbandoned = { id: string; createdAt: string; value: number; currency: string; items: string[] };

export type Step = "cart" | "checkout" | "contact" | "shipping" | "payment" | "purchased";
export const STEP_LABELS: Record<Step, string> = {
  cart: "Added to cart",
  checkout: "Started checkout",
  contact: "Entered contact info",
  shipping: "Chose shipping",
  payment: "Entered payment",
  purchased: "Purchased",
};
const ORDER: Step[] = ["cart", "checkout", "contact", "shipping", "payment", "purchased"];
const PIXEL_STEP: Record<string, Step> = {
  checkout_started: "checkout",
  checkout_contact_info_submitted: "contact",
  checkout_shipping_info_submitted: "shipping",
  payment_info_submitted: "payment",
  checkout_completed: "purchased",
};

export type AbandonedRow = {
  key: string;
  visitorId: string;
  startedAt: string;
  lastActiveAt: string;
  location: { city: string | null; region: string | null; country: string | null };
  device: string | null;
  source: string;
  site: string | null;
  furthest: Step;
  kind: "cart" | "checkout";
  match: (ShopifyAbandoned & { certainty: "likely" }) | null;
};

export type FunnelStep = { step: Step | "sessions"; label: string; count: number; fromPrevious: number | null };

export type Abandonment = {
  funnel: FunnelStep[];
  abandonedCarts: number;
  abandonedCheckouts: number;
  /** Of visits that added to cart / started checkout (and are done), share that didn't buy. */
  cartAbandonRate: number | null;
  checkoutAbandonRate: number | null;
  valueLeft: number;
  currency: string;
  rows: AbandonedRow[];
  shopify: (ShopifyAbandoned & { matchedKey: string | null })[];
  bounceRate: number | null;
  bounceBySite: { site: string; sessions: number; bounceRate: number | null }[];
  stillActive: number;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const DEFAULT_IDLE = 30 * 60_000;
const MATCH_WINDOW = 5 * 60_000;

/** Pixel events belong to a session from its start until 2 hours after its last page view (as in session_facts). */
function stepsFor(f: SessionFact, byVisitor: Map<string, PixelStep[]>): PixelStep[] {
  const from = Date.parse(f.started_at);
  const to = Date.parse(f.ended_at) + 2 * 3_600_000;
  return (byVisitor.get(f.visitor_id) ?? []).filter((p) => {
    const t = Date.parse(p.occurred_at);
    return t >= from && t <= to;
  });
}

export function buildAbandonment(input: { sessions: SessionFact[]; pixel: PixelStep[]; shopify: ShopifyAbandoned[]; now: number; idleMs?: number; currency?: string }): Abandonment {
  const idle = input.idleMs ?? DEFAULT_IDLE;
  const byVisitor = new Map<string, PixelStep[]>();
  for (const p of input.pixel) {
    const g = byVisitor.get(p.visitor_id) ?? [];
    g.push(p);
    byVisitor.set(p.visitor_id, g);
  }

  const counts: Record<Step, number> = { cart: 0, checkout: 0, contact: 0, shipping: 0, payment: 0, purchased: 0 };
  const candidates: (AbandonedRow & { checkoutAt: number | null })[] = [];
  let doneCart = 0;
  let doneCheckout = 0;
  let stillActive = 0;

  for (const f of input.sessions) {
    const steps = stepsFor(f, byVisitor);
    let furthest: Step | null = f.added_to_cart ? "cart" : null;
    if (f.reached_checkout && (!furthest || ORDER.indexOf("checkout") > ORDER.indexOf(furthest))) furthest = "checkout";
    if (f.completed_checkout) furthest = "purchased";
    for (const p of steps) {
      const st = PIXEL_STEP[p.type];
      if (st && (!furthest || ORDER.indexOf(st) > ORDER.indexOf(furthest))) furthest = st;
    }
    if (!furthest) continue;
    for (const st of ORDER) if (ORDER.indexOf(st) <= ORDER.indexOf(furthest)) counts[st] += 1;

    const lastActive = Math.max(Date.parse(f.ended_at), ...steps.map((p) => Date.parse(p.occurred_at)));
    const done = input.now - lastActive >= idle || furthest === "purchased";
    if (!done) {
      stillActive += 1;
      continue;
    }
    doneCart += 1;
    if (furthest !== "cart") doneCheckout += 1;
    if (furthest === "purchased") continue;
    const started = steps.find((p) => p.type === "checkout_started");
    candidates.push({
      key: `${f.visitor_id}:${f.session_id}`,
      visitorId: f.visitor_id,
      startedAt: f.started_at,
      lastActiveAt: new Date(lastActive).toISOString(),
      location: { city: f.city, region: f.region, country: f.country },
      device: f.device,
      source: dimensionValue(f, "source"),
      site: f.landing_host ?? null,
      furthest,
      kind: furthest === "cart" ? "cart" : "checkout",
      match: null,
      checkoutAt: started ? Date.parse(started.occurred_at) : null,
    });
  }

  // Match Shopify's abandoned checkouts to visits by time: nearest checkout start within 5 minutes, one-to-one.
  const pairs: { i: number; j: number; gap: number }[] = [];
  input.shopify.forEach((s, j) => {
    const t = Date.parse(s.createdAt);
    candidates.forEach((c, i) => {
      if (c.checkoutAt === null) return;
      const gap = Math.abs(c.checkoutAt - t);
      if (gap <= MATCH_WINDOW) pairs.push({ i, j, gap });
    });
  });
  pairs.sort((a, b) => a.gap - b.gap);
  const usedRow = new Set<number>();
  const matchedKey = new Map<number, string>();
  for (const p of pairs) {
    if (usedRow.has(p.i) || matchedKey.has(p.j)) continue;
    usedRow.add(p.i);
    matchedKey.set(p.j, candidates[p.i].key);
    candidates[p.i].match = { ...input.shopify[p.j], certainty: "likely" };
  }

  const rows: AbandonedRow[] = candidates.map(({ checkoutAt: _, ...r }) => r).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  const abandonedCarts = rows.filter((r) => r.kind === "cart").length;
  const abandonedCheckouts = rows.filter((r) => r.kind === "checkout").length;
  const k = sessionKpis(input.sessions);

  const bySite = new Map<string, SessionFact[]>();
  for (const f of input.sessions) {
    const site = f.landing_host ?? "(unknown)";
    const g = bySite.get(site) ?? [];
    g.push(f);
    bySite.set(site, g);
  }

  const funnel: FunnelStep[] = [{ step: "sessions", label: "Visits", count: input.sessions.length, fromPrevious: null }];
  let prev = input.sessions.length;
  for (const st of ORDER) {
    funnel.push({ step: st, label: STEP_LABELS[st], count: counts[st], fromPrevious: ratio(counts[st], prev) });
    prev = counts[st];
  }

  return {
    funnel,
    abandonedCarts,
    abandonedCheckouts,
    cartAbandonRate: ratio(abandonedCarts + abandonedCheckouts, doneCart),
    checkoutAbandonRate: ratio(abandonedCheckouts, doneCheckout),
    valueLeft: Math.round(input.shopify.reduce((t, s) => t + s.value, 0) * 100) / 100,
    currency: input.shopify[0]?.currency ?? input.currency ?? "USD",
    rows,
    shopify: input.shopify.map((s, j) => ({ ...s, matchedKey: matchedKey.get(j) ?? null })),
    bounceRate: k.bounceRate,
    bounceBySite: [...bySite.entries()]
      .map(([site, g]) => ({ site, sessions: g.length, bounceRate: sessionKpis(g).bounceRate }))
      .sort((a, b) => b.sessions - a.sessions),
    stillActive,
  };
}

// ─── Shopify's abandoned-checkout list ───────────────────────────────────────

export const Q_ABANDONED = `query Abandoned($first: Int!, $after: String, $query: String) {
  abandonedCheckouts(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      createdAt
      completedAt
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 10) { nodes { title quantity } }
    }
  }
}`;

export type GqlAbandoned = {
  id: string;
  createdAt: string;
  completedAt: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
  lineItems: { nodes: { title: string; quantity: number }[] };
};

/** Value and product names only: no customer details or recovery links (those reopen the buyer's checkout). */
export function mapAbandoned(n: GqlAbandoned): ShopifyAbandoned | null {
  if (n.completedAt) return null;
  return {
    id: n.id.split("/").pop() ?? n.id,
    createdAt: n.createdAt,
    value: Number(n.totalPriceSet?.shopMoney.amount ?? 0),
    currency: n.totalPriceSet?.shopMoney.currencyCode ?? "USD",
    items: n.lineItems.nodes.map((l) => (l.quantity > 1 ? `${l.title} ×${l.quantity}` : l.title)),
  };
}

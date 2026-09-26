import "server-only";
import { Q_ABANDONED, mapAbandoned, type GqlAbandoned, type PixelStep, type ShopifyAbandoned } from "./abandonment";
import { db } from "./db";
import { addDays, type DateRange } from "./metrics/compute";
import type { SessionFact } from "./sessions";
import { adminClient } from "./shopify-admin";

/** Checkout-pixel events from the start of the range until 2 hours after its end (for late checkouts). */
export async function loadPixelSteps(mode: "live" | "demo", r: DateRange, demoSessions: SessionFact[]): Promise<PixelStep[]> {
  if (mode === "demo") {
    // Demo: derive checkout steps from the demo sessions' flags.
    return demoSessions.flatMap((f) => {
      const t = Date.parse(f.ended_at);
      const steps: PixelStep[] = [];
      if (f.reached_checkout) steps.push({ visitor_id: f.visitor_id, type: "checkout_started", occurred_at: new Date(t + 60_000).toISOString() });
      if (f.reached_checkout && (f.completed_checkout || f.pageviews % 2 === 0)) steps.push({ visitor_id: f.visitor_id, type: "checkout_contact_info_submitted", occurred_at: new Date(t + 120_000).toISOString() });
      if (f.completed_checkout) steps.push({ visitor_id: f.visitor_id, type: "checkout_completed", occurred_at: new Date(t + 240_000).toISOString() });
      return steps;
    });
  }
  const out: PixelStep[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await db()
      .from("events")
      .select("visitor_id, type, occurred_at")
      .eq("source", "pixel")
      .gte("occurred_at", `${addDays(r.from, -1)}T00:00:00Z`)
      .lt("occurred_at", `${addDays(r.to, 2)}T00:00:00Z`)
      .order("occurred_at")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`pixel steps failed: ${error.message}`);
    out.push(...((data ?? []) as PixelStep[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const cache = new Map<string, { at: number; rows: ShopifyAbandoned[] | null }>();

/** Shopify's abandoned checkouts created in the range (cached 5 minutes). Null if Shopify can't be reached. */
export async function loadShopifyAbandoned(mode: "live" | "demo", r: DateRange, demoSessions: SessionFact[]): Promise<ShopifyAbandoned[] | null> {
  if (mode === "demo") {
    const PRODUCTS: [string, number][] = [["The Soul Reserve Vol. 2", 39], ["Producer Bundle (5 kits)", 99], ["808 Essentials", 29], ["Late Night Melody Loops", 44]];
    return demoSessions
      .filter((f) => f.reached_checkout && !f.completed_checkout && f.pageviews % 2 === 0)
      .map((f, i) => ({ id: `demo-${i}`, createdAt: new Date(Date.parse(f.ended_at) + 60_000).toISOString(), value: PRODUCTS[i % 4][1], currency: "USD", items: [PRODUCTS[i % 4][0]] }));
  }
  const { SHOPIFY_SHOP_DOMAIN: shop, SHOPIFY_CLIENT_ID: clientId, SHOPIFY_CLIENT_SECRET: clientSecret } = process.env;
  if (!shop || !clientId || !clientSecret) return null;
  const key = `${r.from}|${r.to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.rows;
  let rows: ShopifyAbandoned[] | null = [];
  try {
    const client = adminClient({ shop, clientId, clientSecret });
    let after: string | null = null;
    // Day boundaries are the store's; a day either side, trimmed by the caller's session window.
    const query = `created_at:>='${addDays(r.from, -1)}' created_at:<='${addDays(r.to, 1)}'`;
    for (let page = 0; page < 10; page++) {
      type Page = { abandonedCheckouts: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlAbandoned[] } };
      const res: Page = await client.graphql<Page>(Q_ABANDONED, { first: 100, after, query });
      for (const n of res.abandonedCheckouts.nodes) {
        const m = mapAbandoned(n);
        if (m) rows.push(m);
      }
      if (!res.abandonedCheckouts.pageInfo.hasNextPage) break;
      after = res.abandonedCheckouts.pageInfo.endCursor;
    }
  } catch (e) {
    console.error("abandoned checkouts failed:", e instanceof Error ? e.message : "");
    rows = null;
  }
  if (cache.size > 20) cache.clear();
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

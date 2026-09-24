import "server-only";
import { LOOKBACK_DAYS } from "./attribution";
import { db } from "./db";
import type { SearchTarget } from "./debug";

const DAY = 24 * 60 * 60 * 1000;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return res.data;
}

export type OrderSummary = {
  id: string;
  name: string | null;
  created_at: string;
  total_price: string | null;
  currency: string | null;
  financial_status: string | null;
  stitch_method: string;
  visitor_id: string | null;
};

export type EventRowView = {
  id: string;
  type: string;
  source: string;
  occurred_at: string;
  session_id: string | null;
  path: string | null;
  url: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  msclkid: string | null;
  checkout_token: string | null;
  is_touchpoint: boolean;
};

const ORDER_COLS = "id, name, created_at, total_price, currency, financial_status, stitch_method, visitor_id";
const EVENT_COLS =
  "id, type, source, occurred_at, session_id, path, url, referrer, utm_source, utm_medium, utm_campaign, gclid, fbclid, ttclid, msclkid, checkout_token, is_touchpoint";

export async function loadOverview(now = new Date()) {
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const since24h = new Date(now.getTime() - DAY).toISOString();
  const [forStats, recentOrders, webhooks, events24h, lastEvent, visitors] = await Promise.all([
    db().from("orders").select("created_at, stitch_method").gte("created_at", since30).limit(20000),
    db().from("orders").select(ORDER_COLS).order("created_at", { ascending: false }).limit(50),
    db()
      .from("webhook_events")
      .select("webhook_id, topic, received_at, processed_at, error")
      .order("received_at", { ascending: false })
      .limit(50),
    db().from("events").select("id", { count: "exact", head: true }).gte("received_at", since24h),
    db().from("events").select("received_at, source").order("received_at", { ascending: false }).limit(1),
    db().from("visitors").select("id", { count: "exact", head: true }),
  ]);
  return {
    statsOrders: check(forStats, "orders for stats") ?? [],
    recentOrders: (check(recentOrders, "recent orders") ?? []) as OrderSummary[],
    webhooks: check(webhooks, "webhooks") ?? [],
    events24h: (check(events24h, "events count"), events24h.count ?? 0),
    lastEvent: (check(lastEvent, "last event") ?? [])[0] ?? null,
    visitorCount: (check(visitors, "visitor count"), visitors.count ?? 0),
  };
}

/** Turn a search into the page to show, or null if nothing matches. */
export async function resolveSearch(t: SearchTarget): Promise<string | null> {
  switch (t.kind) {
    case "order_name":
    case "order_id": {
      const col = t.kind === "order_name" ? "name" : "id";
      const rows = check(await db().from("orders").select("id").eq(col, t.value).limit(1), "order search") ?? [];
      return rows[0] ? `/debug/orders/${rows[0].id}` : null;
    }
    case "visitor": {
      const rows = check(await db().from("visitors").select("id").eq("id", t.value).limit(1), "visitor search") ?? [];
      return rows[0] ? `/debug/visitors/${rows[0].id}` : null;
    }
    case "checkout": {
      const orders = check(await db().from("orders").select("id").eq("checkout_token", t.value).limit(1), "checkout search") ?? [];
      if (orders[0]) return `/debug/orders/${orders[0].id}`;
      const ev = check(await db().from("events").select("visitor_id").eq("checkout_token", t.value).limit(1), "checkout event search") ?? [];
      return ev[0] ? `/debug/visitors/${ev[0].visitor_id}` : null;
    }
    default:
      return null;
  }
}

export async function loadOrder(id: string) {
  const order = check(
    await db()
      .from("orders")
      .select(`${ORDER_COLS}, subtotal_price, checkout_token, cancelled_at, landing_site, referring_site, source_name, note_attributes, ingested_via, updated_at`)
      .eq("id", id)
      .maybeSingle(),
    "order",
  );
  if (!order) return null;

  const attributions =
    check(
      await db()
        .from("order_attributions")
        .select("model, channel, credit, event_id, events(occurred_at, path, utm_source, utm_medium, utm_campaign, referrer)")
        .eq("order_id", id),
      "attributions",
    ) ?? [];

  let timeline: EventRowView[] = [];
  if (order.visitor_id) {
    const at = Date.parse(order.created_at);
    timeline = ((check(
      await db()
        .from("events")
        .select(EVENT_COLS)
        .eq("visitor_id", order.visitor_id)
        .gte("occurred_at", new Date(at - LOOKBACK_DAYS * DAY).toISOString())
        .lte("occurred_at", new Date(at + 60 * 60 * 1000).toISOString())
        .order("occurred_at", { ascending: true })
        .limit(1000),
      "timeline",
    ) ?? []) as EventRowView[]);
  }
  return { order, attributions, timeline };
}

export async function loadVisitor(id: string) {
  const visitor = check(
    await db().from("visitors").select("id, first_seen_at, last_seen_at, first_touch").eq("id", id).maybeSingle(),
    "visitor",
  );
  if (!visitor) return null;
  const [events, orders] = await Promise.all([
    db().from("events").select(EVENT_COLS).eq("visitor_id", id).order("occurred_at", { ascending: false }).limit(500),
    db().from("orders").select(ORDER_COLS).eq("visitor_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  return {
    visitor,
    events: (check(events, "visitor events") ?? []) as EventRowView[],
    orders: (check(orders, "visitor orders") ?? []) as OrderSummary[],
  };
}

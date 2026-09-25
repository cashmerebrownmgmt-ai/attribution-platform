import "server-only";
import { cookies } from "next/headers";
import { MODELS, type Model } from "../attribution";
import type { Channel } from "../channel";
import { db } from "../db";
import { generateDemo } from "../demo/generate";
import { toTouch, type TouchSignals } from "../metrics/touch";
import type { Ad, AdGroup, Campaign, DashboardData, HealthData, Insight, OrderFact, Platform, Settings, Touch } from "../metrics/types";

export type Mode = "live" | "demo";
export const MODE_COOKIE = "ap_mode";

export const todayUtc = () => new Date().toISOString().slice(0, 10);

export async function currentMode(): Promise<Mode> {
  // Real data unless this browser explicitly switched to demo, so a new device never shows sample numbers.
  return (await cookies()).get(MODE_COOKIE)?.value === "demo" ? "demo" : "live";
}

let demoCache: { day: string; data: DashboardData } | undefined;

export async function getDashboardData(mode: Mode): Promise<DashboardData> {
  if (mode === "demo") {
    const day = todayUtc();
    if (demoCache?.day !== day) demoCache = { day, data: generateDemo({ endDay: day }) };
    return demoCache.data;
  }
  return loadLive();
}

// ─── Live ─────────────────────────────────────────────────────────────────────

const PAGE = 1000; // PostgREST's default max rows per request

/** Fetch every row of a query, 1,000 at a time. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
  max = 200_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${what} failed: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

type OrderFactRow = { id: string; name: string | null; created_at: string; revenue: string | number; cancelled_at: string | null; stitch_method: string; is_new_customer: boolean };
type AttributionRow = {
  order_id: string;
  model: Model;
  channel: Channel;
  events: (TouchSignals & { occurred_at: string }) | null;
};

async function loadLive(): Promise<DashboardData> {
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const sinceDay = since.slice(0, 10);

  const [orders, attributions, campaigns, adGroups, ads, insights, settingsRow, health, customers, items] = await Promise.all([
    fetchAll<OrderFactRow>(
      (a, b) => db().from("order_facts").select("id, name, created_at, revenue, cancelled_at, stitch_method, is_new_customer").gte("created_at", since).order("created_at").range(a, b),
      "order_facts",
    ),
    fetchAll<AttributionRow>(
      (a, b) =>
        db()
          .from("order_attributions")
          .select("order_id, model, channel, events(occurred_at, utm_source, utm_medium, utm_campaign, utm_content, gclid, fbclid, ttclid, msclkid, referrer)")
          .order("order_id")
          .order("model")
          .range(a, b) as unknown as PromiseLike<{ data: AttributionRow[] | null; error: { message: string } | null }>,
      "order_attributions",
    ),
    fetchAll<Record<string, unknown>>((a, b) => db().from("campaigns").select("*").range(a, b), "campaigns"),
    fetchAll<Record<string, unknown>>((a, b) => db().from("ad_groups").select("*").range(a, b), "ad_groups"),
    fetchAll<Record<string, unknown>>((a, b) => db().from("ads").select("*").range(a, b), "ads"),
    fetchAll<Record<string, unknown>>(
      (a, b) => db().from("ad_insights_daily").select("platform, ad_id, date, spend, impressions, clicks, platform_conversions, platform_revenue").gte("date", sinceDay).order("date").range(a, b),
      "ad_insights_daily",
    ),
    db().from("settings").select("*").maybeSingle(),
    db().rpc("health_summary"),
    fetchAll<{ id: string; customer_id: string | null; email_hash: string | null }>(
      (a, b) => db().from("orders").select("id, customer_id, email_hash").gte("created_at", since).order("id").range(a, b),
      "order customers",
    ),
    fetchAll<{ order_id: string; product_id: string | null; title: string; quantity: number; price: string | number | null }>(
      (a, b) => db().from("order_items").select("order_id, product_id, title, quantity, price").order("order_id").order("line_id").range(a, b),
      "order_items",
    ),
  ]);

  const customerOf = new Map(customers.map((c) => [c.id, c.customer_id ? `c:${c.customer_id}` : c.email_hash ? `e:${c.email_hash}` : null]));
  const emailOf = new Map(customers.map((c) => [c.id, c.email_hash]));
  const itemsOf = new Map<string, OrderFact["items"]>();
  for (const i of items) {
    const list = itemsOf.get(i.order_id) ?? [];
    list.push({ key: i.product_id ? `p:${i.product_id}` : `t:${i.title}`, title: i.title, quantity: i.quantity, revenue: Number(i.price ?? 0) * i.quantity });
    itemsOf.set(i.order_id, list);
  }

  const byOrder = new Map<string, Partial<Record<Model, AttributionRow>>>();
  for (const a of attributions) {
    const m = byOrder.get(a.order_id) ?? {};
    m[a.model] = a;
    byOrder.set(a.order_id, m);
  }

  const touchFor = (a: AttributionRow | undefined): Touch => {
    if (!a?.events) return { ...toTouch(null), channel: a?.channel ?? "direct" };
    return { ...toTouch(a.events), channel: a.channel };
  };

  const facts: OrderFact[] = orders.map((o) => {
    const attr = byOrder.get(o.id) ?? {};
    const touches = Object.fromEntries(MODELS.map((m) => [m, touchFor(attr[m])])) as Record<Model, Touch>;
    const first = attr.first_touch?.events?.occurred_at;
    const path = [touches.first_touch.channel, touches.last_non_direct.channel, touches.last_touch.channel];
    return {
      id: o.id,
      name: o.name ?? o.id,
      createdAt: new Date(o.created_at).toISOString(),
      revenue: Number(o.revenue),
      isNew: o.is_new_customer,
      cancelled: o.cancelled_at !== null,
      stitchMethod: o.stitch_method,
      touches,
      path: o.stitch_method === "none" ? [] : path,
      daysToPurchase: first ? Math.max(0, Math.floor((Date.parse(o.created_at) - Date.parse(first)) / 86_400_000)) : null,
      customerKey: customerOf.get(o.id) ?? null,
      emailHash: emailOf.get(o.id) ?? null,
      items: itemsOf.get(o.id) ?? [],
    };
  });

  const s = settingsRow.data as Record<string, unknown> | null;
  const settings: Settings = {
    currency: (s?.currency as string) ?? "USD",
    targetRoas: s?.target_roas != null ? Number(s.target_roas) : null,
    targetCpa: s?.target_cpa != null ? Number(s.target_cpa) : null,
    breakevenRoas: s?.breakeven_roas != null ? Number(s.breakeven_roas) : null,
    lookbackDays: (s?.lookback_days as number) ?? 30,
    businessName: (s?.business_name as string) ?? null,
  };

  const h = (health.data ?? {}) as Record<string, unknown>;
  const healthData: HealthData = {
    eventsByHour: ((h.events_by_hour as { hour: string; tracker: number; pixel: number }[]) ?? []).map((e) => ({
      hour: new Date(e.hour).toISOString(),
      tracker: Number(e.tracker),
      pixel: Number(e.pixel),
    })),
    lastEventAt: (h.last_event_at as string) ?? null,
    webhooks24h: {
      total: Number((h.webhooks_24h as { total?: number })?.total ?? 0),
      failed: Number((h.webhooks_24h as { failed?: number })?.failed ?? 0),
    },
    lastWebhookAt: (h.last_webhook_at as string) ?? null,
    stitch7d: (h.stitch_7d as Record<string, number>) ?? {},
    pixelCheckouts7d: Number(h.pixel_checkouts_7d ?? 0),
    orders7d: Number(h.orders_7d ?? 0),
  };

  const str = (v: unknown) => (v == null ? null : String(v));
  return {
    mode: "live",
    generatedAt: new Date().toISOString(),
    settings,
    orders: facts,
    campaigns: campaigns.map((c): Campaign => ({
      platform: c.platform as Platform,
      id: String(c.id),
      name: str(c.name) ?? String(c.id),
      status: str(c.status) ?? "unknown",
      objective: str(c.objective),
      dailyBudget: c.daily_budget != null ? Number(c.daily_budget) : null,
    })),
    adGroups: adGroups.map((g): AdGroup => ({
      platform: g.platform as Platform,
      id: String(g.id),
      campaignId: String(g.campaign_id),
      name: str(g.name) ?? String(g.id),
      status: str(g.status) ?? "unknown",
      dailyBudget: g.daily_budget != null ? Number(g.daily_budget) : null,
    })),
    ads: ads.map((a): Ad => ({
      platform: a.platform as Platform,
      id: String(a.id),
      adGroupId: String(a.ad_group_id),
      campaignId: String(a.campaign_id),
      name: str(a.name) ?? String(a.id),
      status: str(a.status) ?? "unknown",
      format: str(a.format),
      headline: str(a.headline),
      body: str(a.body),
      thumbnailUrl: str(a.thumbnail_url),
      videoUrl: str(a.video_url),
      cta: str(a.cta),
      landingUrl: str(a.landing_url),
      launchedAt: str(a.launched_at),
    })),
    insights: insights.map((i): Insight => ({
      platform: i.platform as Platform,
      adId: String(i.ad_id),
      date: String(i.date),
      spend: Number(i.spend),
      impressions: Number(i.impressions),
      clicks: Number(i.clicks),
      platformConversions: i.platform_conversions != null ? Number(i.platform_conversions) : null,
      platformRevenue: i.platform_revenue != null ? Number(i.platform_revenue) : null,
    })),
    health: healthData,
  };
}

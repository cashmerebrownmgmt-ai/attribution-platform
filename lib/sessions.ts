/**
 * Session analytics, Shopify-style: sessions, visitors, funnel and breakdowns. Pure.
 * Input is one row per storefront session (the session_facts database function, or demo data).
 */
import { CHANNEL_LABELS } from "./debug";
import { addDays, dayOf, daysIn, ratio, type DateRange } from "./metrics/compute";
import { sourceLabel } from "./live";

export type SessionFact = {
  session_id: string;
  visitor_id: string;
  started_at: string;
  ended_at: string;
  pageviews: number;
  landing_path: string | null;
  landing_title: string | null;
  exit_path: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  msclkid: string | null;
  referrer: string | null;
  device: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  is_new_visitor: boolean;
  added_to_cart: boolean;
  reached_checkout: boolean;
  completed_checkout: boolean;
};

export type SessionKpis = {
  sessions: number;
  visitors: number;
  newVisitors: number;
  returningVisitors: number;
  pageviews: number;
  pagesPerSession: number | null;
  avgDurationSec: number | null;
  bounceRate: number | null;
  addToCartRate: number | null;
  checkoutRate: number | null;
  conversionRate: number | null;
  funnel: { label: string; sessions: number; rate: number | null }[];
};

export type Breakdown = {
  key: string;
  label: string;
  sessions: number;
  share: number;
  visitors: number;
  bounceRate: number | null;
  addToCartRate: number | null;
  conversionRate: number | null;
  conversions: number;
};

const inRange = (iso: string, r: DateRange) => dayOf(iso) >= r.from && dayOf(iso) <= r.to;

export function sessionsIn(facts: SessionFact[], r: DateRange): SessionFact[] {
  return facts.filter((f) => inRange(f.started_at, r));
}

export function sessionKpis(facts: SessionFact[]): SessionKpis {
  const n = facts.length;
  const visitors = new Set(facts.map((f) => f.visitor_id));
  const newVisitors = new Set(facts.filter((f) => f.is_new_visitor).map((f) => f.visitor_id));
  const pageviews = facts.reduce((t, f) => t + f.pageviews, 0);
  // Duration is measurable only when a session has 2+ events; single-page sessions count as 0s (as Shopify does).
  const totalSec = facts.reduce((t, f) => t + Math.max(0, (Date.parse(f.ended_at) - Date.parse(f.started_at)) / 1000), 0);
  const bounces = facts.filter((f) => f.pageviews <= 1 && !f.added_to_cart && !f.reached_checkout).length;
  const cart = facts.filter((f) => f.added_to_cart || f.reached_checkout).length;
  const checkout = facts.filter((f) => f.reached_checkout).length;
  const converted = facts.filter((f) => f.completed_checkout).length;
  return {
    sessions: n,
    visitors: visitors.size,
    newVisitors: newVisitors.size,
    returningVisitors: visitors.size - newVisitors.size,
    pageviews,
    pagesPerSession: ratio(pageviews, n),
    avgDurationSec: ratio(totalSec, n),
    bounceRate: ratio(bounces, n),
    addToCartRate: ratio(cart, n),
    checkoutRate: ratio(checkout, n),
    conversionRate: ratio(converted, n),
    funnel: [
      { label: "Sessions", sessions: n, rate: n ? 1 : null },
      { label: "Added to cart", sessions: cart, rate: ratio(cart, n) },
      { label: "Reached checkout", sessions: checkout, rate: ratio(checkout, n) },
      { label: "Purchased", sessions: converted, rate: ratio(converted, n) },
    ],
  };
}

export type SessionDay = { date: string; sessions: number; visitors: number; conversions: number; conversionRate: number | null };

export function sessionsByDay(facts: SessionFact[], r: DateRange): SessionDay[] {
  const days = new Map(daysIn(r).map((d) => [d, { sessions: 0, visitors: new Set<string>(), conversions: 0 }]));
  for (const f of facts) {
    const d = days.get(dayOf(f.started_at));
    if (!d) continue;
    d.sessions += 1;
    d.visitors.add(f.visitor_id);
    if (f.completed_checkout) d.conversions += 1;
  }
  return [...days.entries()].map(([date, d]) => ({ date, sessions: d.sessions, visitors: d.visitors.size, conversions: d.conversions, conversionRate: ratio(d.conversions, d.sessions) }));
}

export type Dimension = "channel" | "source" | "campaign" | "landing" | "device" | "country" | "region" | "city" | "referrer" | "visitorType" | "exit";

export const DIMENSION_LABELS: Record<Dimension, string> = {
  channel: "Channel",
  source: "Source",
  campaign: "Campaign",
  landing: "Landing page",
  device: "Device",
  country: "Country",
  region: "Region",
  city: "City",
  referrer: "Referring site",
  visitorType: "New vs returning",
  exit: "Exit page",
};

function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function dimensionValue(f: SessionFact, d: Dimension): string {
  switch (d) {
    case "channel": {
      const c = sourceLabel(f).channel;
      return CHANNEL_LABELS[c] ?? c;
    }
    case "source":
      return sourceLabel(f).label;
    case "campaign":
      return f.utm_campaign ?? "(none)";
    case "landing":
      return f.landing_path ?? "(unknown)";
    case "device":
      return f.device ? f.device[0].toUpperCase() + f.device.slice(1) : "Unknown";
    case "country":
      return f.country ?? "Unknown";
    case "region":
      return f.region ? `${f.region}${f.country ? `, ${f.country}` : ""}` : "Unknown";
    case "city":
      return f.city ? [f.city, f.region, f.country].filter(Boolean).join(", ") : "Unknown";
    case "referrer":
      return host(f.referrer) ?? "(direct / none)";
    case "visitorType":
      return f.is_new_visitor ? "New visitor" : "Returning visitor";
    case "exit":
      return f.exit_path ?? "(unknown)";
  }
}

export function breakdown(facts: SessionFact[], d: Dimension, limit = 25): Breakdown[] {
  const groups = new Map<string, SessionFact[]>();
  for (const f of facts) {
    const k = dimensionValue(f, d);
    const g = groups.get(k) ?? [];
    g.push(f);
    groups.set(k, g);
  }
  const total = facts.length;
  return [...groups.entries()]
    .map(([label, g]) => {
      const k = sessionKpis(g);
      return {
        key: label,
        label,
        sessions: g.length,
        share: total ? g.length / total : 0,
        visitors: k.visitors,
        bounceRate: k.bounceRate,
        addToCartRate: k.addToCartRate,
        conversionRate: k.conversionRate,
        conversions: g.filter((f) => f.completed_checkout).length,
      };
    })
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

/** The same-length period before `r`, for comparisons. */
export function previousSessionRange(r: DateRange): DateRange {
  const len = daysIn(r).length;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

export function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "—";
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

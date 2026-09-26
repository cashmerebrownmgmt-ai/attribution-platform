/**
 * Live visitors: group the last few minutes of events into sessions with location, source,
 * device and a short activity trail. Pure.
 */
import { classifyChannel, type Channel } from "./channel";
import { isLandingSite, siteOf, STORE_HOSTS } from "./store-hosts";

export type LiveEvent = {
  id: string;
  visitor_id: string;
  session_id: string | null;
  type: string;
  source: "tracker" | "pixel";
  occurred_at: string;
  url?: string | null;
  path: string | null;
  title: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  msclkid: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
};

export type CheckoutStage = "none" | "started" | "contact" | "shipping" | "payment" | "purchased";

export type LiveSession = {
  key: string;
  visitorId: string;
  startedAt: string;
  lastSeenAt: string;
  /** Seen within the "active" window (default 5 minutes). */
  active: boolean;
  location: { city: string | null; region: string | null; country: string | null };
  device: string | null;
  channel: Channel;
  sourceLabel: string;
  campaign: string | null;
  landingPath: string | null;
  currentPath: string | null;
  currentTitle: string | null;
  /** The site the visitor is on now / arrived on: the store's host, or a landing page's. */
  site: string | null;
  landingSite: string | null;
  /** Currently on an off-store landing page (and not yet in checkout). */
  onLandingPage: boolean;
  pageViews: number;
  checkout: CheckoutStage;
  /** Newest first, at most `trail` items. */
  activity: { at: string; label: string; path: string | null; site: string | null; kind: "page" | "checkout" | "cart" }[];
};

export type LiveSummary = {
  activeNow: number;
  sessions: LiveSession[];
  topLocations: { label: string; count: number }[];
  topSources: { label: string; count: number }[];
  topPages: { label: string; count: number }[];
  inCheckout: number;
  purchases: number;
  /** Active visitors on off-store landing pages right now. */
  onLandingPages: number;
  /** Of visits in the window that have ended, the share that saw one page and left (no cart, no checkout). */
  bounceRate: number | null;
};

const STAGE_BY_TYPE: Record<string, CheckoutStage> = {
  checkout_started: "started",
  checkout_contact_info_submitted: "contact",
  checkout_shipping_info_submitted: "shipping",
  payment_info_submitted: "payment",
  checkout_completed: "purchased",
};
const STAGE_ORDER: CheckoutStage[] = ["none", "started", "contact", "shipping", "payment", "purchased"];
export const STAGE_LABELS: Record<CheckoutStage, string> = {
  none: "Browsing",
  started: "Started checkout",
  contact: "Entered contact info",
  shipping: "Chose shipping",
  payment: "Entered payment",
  purchased: "Purchased",
};

const SOURCE_NAMES: Record<Channel, string> = {
  paid_search: "Paid search",
  paid_social: "Paid social",
  organic_search: "Search",
  organic_social: "Social",
  email: "Email",
  sms: "SMS",
  affiliate: "Affiliate",
  referral: "Referral",
  other_campaign: "Campaign",
  direct: "Direct",
};

function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "Google Ads", "Instagram", "Email · spring_sale", "Direct"… */
export function sourceLabel(e: Pick<LiveEvent, "utm_source" | "utm_medium" | "referrer" | "gclid" | "fbclid" | "ttclid" | "msclkid">): { channel: Channel; label: string } {
  const channel = classifyChannel(e);
  if (e.gclid) return { channel, label: "Google Ads" };
  if (e.msclkid) return { channel, label: "Microsoft Ads" };
  if (e.ttclid) return { channel, label: "TikTok Ads" };
  if (e.utm_source) return { channel, label: `${e.utm_source}${e.utm_medium ? ` / ${e.utm_medium}` : ""}` };
  const ref = host(e.referrer);
  if (ref) return { channel, label: ref };
  return { channel, label: SOURCE_NAMES[channel] };
}

export function locationLabel(l: LiveSession["location"]): string {
  return [l.city, l.region && l.region !== l.city ? l.region : null, l.country].filter(Boolean).join(", ") || "Unknown location";
}

export function liveSummary(events: LiveEvent[], now: number, opts: { activeMinutes?: number; trail?: number; storeHosts?: string[] } = {}): LiveSummary {
  const storeHosts = opts.storeHosts ?? STORE_HOSTS;
  const activeMs = (opts.activeMinutes ?? 5) * 60_000;
  const trail = opts.trail ?? 8;
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  // Pixel (checkout) events have no session ID; attach them to the visitor's latest storefront session.
  const latestSession = new Map<string, string>();
  const groups = new Map<string, LiveEvent[]>();
  for (const e of sorted) {
    let key: string;
    if (e.session_id) {
      key = `${e.visitor_id}:${e.session_id}`;
      latestSession.set(e.visitor_id, key);
    } else {
      key = latestSession.get(e.visitor_id) ?? `${e.visitor_id}:checkout`;
    }
    const g = groups.get(key) ?? [];
    g.push(e);
    groups.set(key, g);
  }

  const sessions: LiveSession[] = [...groups.entries()].map(([key, evs]) => {
    const pages = evs.filter((e) => e.source === "tracker" && e.type === "page_view");
    const first = pages[0] ?? evs[0];
    const last = evs[evs.length - 1];
    const lastPage = pages[pages.length - 1] ?? null;
    const touch = pages.find((e) => e.utm_source || e.gclid || e.fbclid || e.ttclid || e.msclkid || e.referrer) ?? first;
    const src = sourceLabel(touch);
    const geo = [...evs].reverse().find((e) => e.country || e.city) ?? null;
    const device = [...evs].reverse().find((e) => e.device)?.device ?? null;
    let checkout: CheckoutStage = "none";
    for (const e of evs) {
      const stage = STAGE_BY_TYPE[e.type];
      if (stage && STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(checkout)) checkout = stage;
    }
    const activity = evs
      .slice(-trail)
      .reverse()
      .map((e) => {
        const site = siteOf(e.url);
        if (STAGE_BY_TYPE[e.type]) return { at: e.occurred_at, label: STAGE_LABELS[STAGE_BY_TYPE[e.type]], path: e.path, site, kind: "checkout" as const };
        if (e.type === "add_to_cart")
          return { at: e.occurred_at, label: isLandingSite(site, storeHosts) ? "Clicked buy → going to checkout" : "Added to cart", path: e.path, site, kind: "cart" as const };
        return { at: e.occurred_at, label: e.title || e.path || "Page", path: e.path, site, kind: "page" as const };
      });
    const site = siteOf(lastPage?.url ?? null);

    return {
      key,
      visitorId: evs[0].visitor_id,
      startedAt: first.occurred_at,
      lastSeenAt: last.occurred_at,
      active: now - Date.parse(last.occurred_at) <= activeMs,
      location: { city: geo?.city ?? null, region: geo?.region ?? null, country: geo?.country ?? null },
      device,
      channel: src.channel,
      sourceLabel: src.label,
      campaign: touch.utm_campaign,
      landingPath: first.path,
      currentPath: lastPage?.path ?? last.path,
      currentTitle: lastPage?.title ?? null,
      site,
      landingSite: siteOf(first.url ?? null),
      onLandingPage: isLandingSite(site, storeHosts) && checkout === "none",
      pageViews: pages.length,
      checkout,
      activity,
    };
  });

  sessions.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  const active = sessions.filter((s) => s.active);

  const top = (xs: string[], n = 5) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }));
  };

  return {
    activeNow: active.length,
    sessions,
    topLocations: top(active.map((s) => locationLabel(s.location))),
    topSources: top(active.map((s) => s.sourceLabel)),
    topPages: top(active.map((s) => `${s.onLandingPage ? `${s.site} · ` : ""}${s.currentTitle || s.currentPath || "Unknown"}`)),
    inCheckout: active.filter((s) => s.checkout !== "none" && s.checkout !== "purchased").length,
    purchases: sessions.filter((s) => s.checkout === "purchased").length,
    onLandingPages: active.filter((s) => s.onLandingPage).length,
    bounceRate: (() => {
      const left = sessions.filter((s) => !s.active);
      if (!left.length) return null;
      const bounced = left.filter((s) => s.pageViews <= 1 && s.checkout === "none" && !s.activity.some((a) => a.kind === "cart")).length;
      return bounced / left.length;
    })(),
  };
}

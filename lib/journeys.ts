/**
 * Shopify's own customer-journey data (the first and last visit Shopify recorded before each order),
 * used to attribute orders our tracking didn't match. Pure: GraphQL mapping, privacy trimming, and
 * turning a visit into a touch. The Shopify client and storage are injected into syncJourneys.
 */
import type { Model } from "./attribution";
import { toTouch } from "./metrics/touch";
import type { Touch } from "./metrics/types";

export const Q_JOURNEYS = `query Journeys($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId
      customerJourneySummary {
        ready
        daysToConversion
        momentsCount { count }
        firstVisit { occurredAt landingPage referrerUrl source sourceType utmParameters { source medium campaign content term } }
        lastVisit { occurredAt landingPage referrerUrl source sourceType utmParameters { source medium campaign content term } }
      }
    }
  }
}`;

type GqlVisit = {
  occurredAt: string | null;
  landingPage: string | null;
  referrerUrl: string | null;
  source: string | null;
  sourceType: string | null;
  utmParameters: { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null } | null;
} | null;

export type GqlJourneyOrder = {
  legacyResourceId: string;
  customerJourneySummary: { ready: boolean; daysToConversion: number | null; momentsCount: { count: number } | null; firstVisit: GqlVisit; lastVisit: GqlVisit } | null;
};

/** A visit, trimmed for privacy: UTMs and click IDs, the landing path (no query string) and the referrer's domain. */
export type Visit = {
  at: string | null;
  landingPath: string | null;
  referrerHost: string | null;
  source: string | null;
  sourceType: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null };
  clickIds: { gclid: string | null; fbclid: string | null; ttclid: string | null; msclkid: string | null };
};

export type JourneyRow = {
  order_id: string;
  ready: boolean;
  days_to_conversion: number | null;
  moments: number | null;
  first_visit: Visit | null;
  last_visit: Visit | null;
  fetched_at: string;
};

const clean = (v: string | null | undefined, max = 200) => {
  const s = v?.trim();
  return s ? s.slice(0, max) : null;
};

function parseUrl(u: string | null | undefined): URL | null {
  if (!u) return null;
  try {
    return new URL(u);
  } catch {
    try {
      return new URL(u, "https://store.invalid");
    } catch {
      return null;
    }
  }
}

export function toVisit(v: GqlVisit): Visit | null {
  if (!v) return null;
  const landing = parseUrl(v.landingPage);
  const ref = parseUrl(v.referrerUrl);
  const q = (k: string) => clean(landing?.searchParams.get(k));
  const utm = v.utmParameters;
  return {
    at: v.occurredAt,
    landingPath: landing ? clean(landing.pathname, 300) : null,
    referrerHost: ref && ref.hostname && ref.hostname !== "store.invalid" ? ref.hostname.toLowerCase() : v.referrerUrl?.startsWith("android-app://") ? clean(v.referrerUrl.split("/")[2]) : null,
    source: clean(v.source),
    sourceType: clean(v.sourceType),
    utm: {
      source: clean(utm?.source ?? q("utm_source")),
      medium: clean(utm?.medium ?? q("utm_medium")),
      campaign: clean(utm?.campaign ?? q("utm_campaign")),
      content: clean(utm?.content ?? q("utm_content")),
      term: clean(utm?.term ?? q("utm_term")),
    },
    clickIds: { gclid: q("gclid"), fbclid: q("fbclid"), ttclid: q("ttclid"), msclkid: q("msclkid") },
  };
}

export function mapJourney(o: GqlJourneyOrder, now: string): JourneyRow {
  const j = o.customerJourneySummary;
  return {
    order_id: o.legacyResourceId,
    ready: j?.ready ?? false,
    days_to_conversion: j?.daysToConversion ?? null,
    moments: j?.momentsCount?.count ?? null,
    first_visit: toVisit(j?.firstVisit ?? null),
    last_visit: toVisit(j?.lastVisit ?? null),
    fetched_at: now,
  };
}

const SOCIAL_NAMES = /^(facebook|instagram|tiktok|youtube|pinterest|twitter|x|linkedin|reddit|snapchat|threads)$/i;
const SEARCH_NAMES = /^(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex)$/i;
const MAIL_APPS = /(^|\.)(mail\.|com\.google\.android\.gm$|outlook\.|com\.microsoft\.office\.outlook$|com\.yahoo\.mobile\.client\.android\.mail$)/;

/**
 * The touch for a Shopify-recorded visit, using the same channel rules as our own tracking.
 * Where there are no UTMs or referrer, Shopify's own source labels fill in (e.g. NEWSLETTER → email).
 */
export function visitTouch(v: Visit): Touch {
  const noUtm = !v.utm.source && !v.utm.medium && !Object.values(v.clickIds).some(Boolean);
  // Mail apps (e.g. the Gmail app, com.google.android.gm) would otherwise look like Google search.
  if (noUtm && v.referrerHost && MAIL_APPS.test(v.referrerHost)) return { channel: "email", platform: null, campaignId: null, adId: null };
  const t = toTouch({
    utm_source: v.utm.source,
    utm_medium: v.utm.medium,
    utm_campaign: v.utm.campaign,
    utm_content: v.utm.content,
    gclid: v.clickIds.gclid,
    fbclid: v.clickIds.fbclid,
    ttclid: v.clickIds.ttclid,
    msclkid: v.clickIds.msclkid,
    referrer: v.referrerHost ? `https://${v.referrerHost}/` : null,
  });
  if (t.channel !== "direct") return t;
  const type = v.sourceType?.toUpperCase() ?? "";
  const src = v.source?.trim() ?? "";
  const none: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
  if (type === "NEWSLETTER" || /mail/i.test(v.referrerHost ?? "")) return { ...none, channel: "email" };
  if (type === "SEO" || SEARCH_NAMES.test(src)) return { ...none, channel: "organic_search" };
  if (type === "SOCIAL" || SOCIAL_NAMES.test(src)) return { ...none, channel: "organic_social" };
  if (type === "REFERRAL") return { ...none, channel: "referral" };
  return t;
}

/**
 * Touches for each attribution model from Shopify's first and last visit. Last non-direct falls back
 * to the first visit when the last one was direct. Null when Shopify recorded no visits.
 */
export function journeyTouches(row: Pick<JourneyRow, "first_visit" | "last_visit">): Record<Model, Touch> | null {
  const first = row.first_visit ? visitTouch(row.first_visit) : null;
  const last = row.last_visit ? visitTouch(row.last_visit) : null;
  if (!first && !last) return null;
  const f = first ?? last!;
  const l = last ?? first!;
  return { first_touch: f, last_touch: l, last_non_direct: l.channel !== "direct" ? l : f };
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export type JourneyDeps = {
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
  store: { upsertJourneys(rows: JourneyRow[]): Promise<void> };
  now?: () => Date;
};

type Page = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlJourneyOrder[] } };

/** Fetch and store Shopify's journey for every order created on or after `since` (YYYY-MM-DD). */
export async function syncJourneys(deps: JourneyDeps, opts: { since: string; maxPages?: number }): Promise<{ orders: number; withVisits: number; notReady: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) throw new Error("since must be YYYY-MM-DD");
  const now = (deps.now ?? (() => new Date()))().toISOString();
  let after: string | null = null;
  let orders = 0;
  let withVisits = 0;
  let notReady = 0;
  for (let page = 0; page < (opts.maxPages ?? 200); page++) {
    const r: Page = await deps.graphql<Page>(Q_JOURNEYS, { first: 100, after, query: `created_at:>=${opts.since}` });
    const rows = r.orders.nodes.map((o) => mapJourney(o, now));
    if (rows.length) await deps.store.upsertJourneys(rows);
    orders += rows.length;
    withVisits += rows.filter((x) => x.first_visit || x.last_visit).length;
    notReady += rows.filter((x) => !x.ready).length;
    if (!r.orders.pageInfo.hasNextPage) break;
    after = r.orders.pageInfo.endCursor;
  }
  return { orders, withVisits, notReady };
}

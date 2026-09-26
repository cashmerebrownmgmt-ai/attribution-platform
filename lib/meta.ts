/**
 * Meta Marketing API connector (read-only): campaigns, ad sets, ads with creatives, and daily
 * ad-level insights. Responses are validated with zod and mapped by pure functions; the network
 * client and the store are injected so the sync can be tested without either.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";

/** Pinned Graph API version. v26.0 released 2026-07-29. */
export const META_API_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

// ─── Response shapes ─────────────────────────────────────────────────────────

const id = z.union([z.string(), z.number()]).transform(String);
const optStr = z.string().nullish();
const minorUnits = z.union([z.string(), z.number()]).nullish(); // budgets come in cents, as strings

const accountSchema = z.object({ id, account_id: id.optional(), name: optStr, currency: optStr, timezone_name: optStr });

const campaignSchema = z.object({ id, name: optStr, effective_status: optStr, status: optStr, objective: optStr, daily_budget: minorUnits });

const adSetSchema = z.object({ id, name: optStr, campaign_id: id, effective_status: optStr, status: optStr, daily_budget: minorUnits });

const linkish = z
  .object({
    link: optStr,
    message: optStr,
    name: optStr,
    picture: optStr,
    image_url: optStr,
    title: optStr,
    video_id: optStr,
    call_to_action: z.object({ type: optStr, value: z.object({ link: optStr }).passthrough().nullish() }).passthrough().nullish(),
    child_attachments: z.array(z.unknown()).nullish(),
  })
  .passthrough();

const creativeSchema = z
  .object({
    id: id.optional(),
    title: optStr,
    body: optStr,
    thumbnail_url: optStr,
    image_url: optStr,
    video_id: optStr,
    object_type: optStr,
    call_to_action_type: optStr,
    url_tags: optStr,
    object_story_spec: z.object({ link_data: linkish.nullish(), video_data: linkish.nullish() }).passthrough().nullish(),
  })
  .passthrough();

const adSchema = z.object({
  id,
  name: optStr,
  adset_id: id,
  campaign_id: id,
  effective_status: optStr,
  status: optStr,
  created_time: optStr,
  creative: creativeSchema.nullish(),
});

const accountSpendSchema = z.object({ date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), spend: z.union([z.string(), z.number()]).nullish() });

const actionList = z.array(z.object({ action_type: z.string(), value: z.union([z.string(), z.number()]) }).passthrough()).nullish();

const insightSchema = z.object({
  ad_id: id,
  date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend: z.union([z.string(), z.number()]).nullish(),
  impressions: z.union([z.string(), z.number()]).nullish(),
  inline_link_clicks: z.union([z.string(), z.number()]).nullish(),
  reach: z.union([z.string(), z.number()]).nullish(),
  actions: actionList,
  action_values: actionList,
  video_play_actions: actionList,
});

export type MetaAccount = z.infer<typeof accountSchema>;
export type MetaCampaign = z.infer<typeof campaignSchema>;
export type MetaAdSet = z.infer<typeof adSetSchema>;
export type MetaAd = z.infer<typeof adSchema>;
export type MetaInsight = z.infer<typeof insightSchema>;

// ─── Rows for our tables ─────────────────────────────────────────────────────

export type AccountRow = { platform: "meta"; id: string; name: string | null; currency: string | null; timezone: string | null; synced_at?: string };
export type AccountDailyRow = { platform: "meta"; account_id: string; date: string; spend: number; updated_at: string };
export type CampaignRow = { platform: "meta"; id: string; account_id: string; name: string | null; status: string; objective: string | null; daily_budget: number | null; updated_at: string };
export type AdGroupRow = { platform: "meta"; id: string; campaign_id: string; name: string | null; status: string; daily_budget: number | null; updated_at: string };
export type AdRow = {
  platform: "meta";
  id: string;
  ad_group_id: string;
  campaign_id: string;
  name: string | null;
  status: string;
  format: string;
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  cta: string | null;
  landing_url: string | null;
  launched_at: string | null;
  updated_at: string;
};
export type InsightRow = {
  platform: "meta";
  ad_id: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number | null;
  video_views: number | null;
  platform_conversions: number | null;
  platform_revenue: number | null;
  updated_at: string;
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const fromCents = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.round(num(v)) / 100);
export const bareAccountId = (v: string) => v.replace(/^act_/, "");

/** ACTIVE → active; PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED → paused; everything else lowercased. */
export function mapStatus(effective: string | null | undefined, configured?: string | null): string {
  const s = (effective ?? configured ?? "unknown").toUpperCase();
  if (s === "ACTIVE") return "active";
  if (s.endsWith("PAUSED")) return "paused";
  return s.toLowerCase();
}

/** "SHOP_NOW" → "Shop now". */
export function ctaLabel(type: string | null | undefined): string | null {
  if (!type || type === "NO_BUTTON") return null;
  const words = type.toLowerCase().split("_").filter(Boolean);
  return words.length ? words.join(" ").replace(/^./, (c) => c.toUpperCase()) : null;
}

/** The ad's destination with its URL parameters (where the UTM tags live on Meta). */
export function landingUrl(link: string | null | undefined, urlTags: string | null | undefined): string | null {
  if (!link) return urlTags ? `?${urlTags.replace(/^\?/, "")}` : null;
  if (!urlTags) return link;
  const tags = urlTags.replace(/^[?&]/, "");
  const [base, hash] = link.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}${tags}${hash !== undefined ? `#${hash}` : ""}`;
}

/**
 * Meta reports the same purchases under several action types. Take one, in order of preference,
 * so they're never double-counted: omni_purchase (all surfaces), then purchase, then the pixel's.
 */
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
export function purchases(list: MetaInsight["actions"]): number | null {
  if (!list?.length) return null;
  for (const t of PURCHASE_TYPES) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return null;
}

export const mapAccount = (a: MetaAccount): AccountRow => ({ platform: "meta", id: bareAccountId(a.account_id ?? a.id), name: a.name ?? null, currency: a.currency ?? null, timezone: a.timezone_name ?? null });

export const mapCampaign = (c: MetaCampaign, accountId: string, now: string): CampaignRow => ({
  platform: "meta",
  id: c.id,
  account_id: accountId,
  name: c.name ?? null,
  status: mapStatus(c.effective_status, c.status),
  objective: c.objective ? c.objective.replace(/^OUTCOME_/, "").toLowerCase() : null,
  daily_budget: fromCents(c.daily_budget),
  updated_at: now,
});

export const mapAdSet = (s: MetaAdSet, now: string): AdGroupRow => ({
  platform: "meta",
  id: s.id,
  campaign_id: s.campaign_id,
  name: s.name ?? null,
  status: mapStatus(s.effective_status, s.status),
  daily_budget: fromCents(s.daily_budget),
  updated_at: now,
});

export function mapAd(a: MetaAd, now: string): AdRow {
  const c = a.creative ?? {};
  const spec = c.object_story_spec?.video_data ?? c.object_story_spec?.link_data ?? null;
  const videoId = c.video_id ?? c.object_story_spec?.video_data?.video_id ?? null;
  const carousel = (c.object_story_spec?.link_data?.child_attachments?.length ?? 0) > 1;
  const format = videoId || c.object_type === "VIDEO" ? "video" : carousel ? "carousel" : "image";
  const link = spec?.link ?? spec?.call_to_action?.value?.link ?? null;
  return {
    platform: "meta",
    id: a.id,
    ad_group_id: a.adset_id,
    campaign_id: a.campaign_id,
    name: a.name ?? null,
    status: mapStatus(a.effective_status, a.status),
    format,
    headline: c.title ?? spec?.name ?? spec?.title ?? null,
    body: c.body ?? spec?.message ?? null,
    // image_url is full size for image ads; thumbnail_url is a small preview (the only one for videos).
    thumbnail_url: (format === "image" ? (c.image_url ?? spec?.image_url ?? spec?.picture) : null) ?? c.thumbnail_url ?? spec?.image_url ?? null,
    video_url: null, // playable sources need a separate, permission-gated call; the preview uses the thumbnail
    cta: ctaLabel(c.call_to_action_type ?? spec?.call_to_action?.type),
    landing_url: landingUrl(link, c.url_tags),
    launched_at: a.created_time ? new Date(a.created_time).toISOString() : null,
    updated_at: now,
  };
}

export function mapInsight(i: MetaInsight, now: string): InsightRow {
  const views = i.video_play_actions?.reduce((t, a) => t + num(a.value), 0);
  const conversions = purchases(i.actions);
  const revenue = purchases(i.action_values);
  return {
    platform: "meta",
    ad_id: i.ad_id,
    date: i.date_start,
    spend: money(i.spend),
    impressions: Math.round(num(i.impressions)),
    clicks: Math.round(num(i.inline_link_clicks)), // link clicks, so CTR means "clicked through to the store"
    reach: i.reach == null ? null : Math.round(num(i.reach)),
    video_views: views === undefined ? null : Math.round(views),
    platform_conversions: conversions === null ? null : money(conversions),
    platform_revenue: revenue === null ? null : money(revenue),
    updated_at: now,
  };
}

// ─── Client ──────────────────────────────────────────────────────────────────

export type MetaFetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; json(): Promise<unknown> }>;

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly status: number,
  ) {
    super(message);
  }
}

// Throttling codes worth waiting out: app/user/account rate limits and "too many calls".
const RETRYABLE = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014]);

export type MetaClient = { getAll<T>(path: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<T[]>; getOne<T>(path: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<T> };

export function metaClient(opts: { token: string; appSecret?: string; fetch?: MetaFetch; sleep?: (ms: number) => Promise<void>; maxPages?: number }): MetaClient {
  const doFetch: MetaFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // The token goes in a header (never the URL, so it can't leak into logs or paging links).
  const headers = { Authorization: `Bearer ${opts.token}` };
  const proof = opts.appSecret ? createHmac("sha256", opts.appSecret).update(opts.token).digest("hex") : null;

  const withProof = (url: string) => {
    if (!proof) return url;
    const u = new URL(url);
    u.searchParams.set("appsecret_proof", proof);
    return u.toString();
  };

  async function call(url: string): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(withProof(url), { headers });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const err = body.error as { message?: string; code?: number } | undefined;
      if (res.status < 400 && !err) return body;
      const code = err?.code ?? null;
      const tooMuchData = code === 1 && /reduce the amount of data/i.test(err?.message ?? "");
      if (!tooMuchData && attempt < 3 && (res.status === 429 || res.status >= 500 || (code !== null && RETRYABLE.has(code)))) {
        await sleep(2000 * 4 ** attempt);
        continue;
      }
      // Meta's messages don't include the token; keep them for diagnosis.
      throw new MetaApiError(err?.message ?? `Meta API returned ${res.status}`, code, res.status);
    }
  }

  const build = (path: string, params: Record<string, string>) => {
    const u = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };

  return {
    async getOne(path, params, schema) {
      return schema.parse(await call(build(path, params)));
    },
    async getAll(path, params, schema) {
      const out = [];
      let url: string | null = build(path, params);
      for (let page = 0; url && page < (opts.maxPages ?? 500); page++) {
        let body: Record<string, unknown>;
        try {
          body = await call(url);
        } catch (e) {
          // "Please reduce the amount of data you're asking for": retry the same page with half the page size.
          const u: URL = new URL(url);
          const limit = Number(u.searchParams.get("limit") ?? 25);
          if (e instanceof MetaApiError && e.code === 1 && limit > 5) {
            u.searchParams.set("limit", String(Math.max(5, Math.floor(limit / 2))));
            url = u.toString();
            page--;
            continue;
          }
          throw e;
        }
        const rows = z.array(z.unknown()).parse(body.data ?? []);
        for (const r of rows) out.push(schema.parse(r));
        const next = (body.paging as { next?: string } | undefined)?.next ?? null;
        url = next && next.startsWith(GRAPH.slice(0, "https://graph.facebook.com".length)) ? next : null;
      }
      return out;
    },
  };
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export type MetaStore = {
  upsertAccount(row: AccountRow): Promise<void>;
  upsertCampaigns(rows: CampaignRow[]): Promise<void>;
  upsertAdGroups(rows: AdGroupRow[]): Promise<void>;
  upsertAds(rows: AdRow[]): Promise<void>;
  upsertInsights(rows: InsightRow[]): Promise<void>;
  upsertAccountDaily(rows: AccountDailyRow[]): Promise<void>;
};

export type SyncSummary = {
  account: string;
  campaigns: number;
  adSets: number;
  ads: number;
  insightRows: number;
  skippedInsights: number;
  spend: number;
  /** Meta's own account-level total for the same days; should equal `spend`. */
  accountSpend: number;
  since: string;
  until: string;
  dryRun: boolean;
};

const AD_FIELDS = [
  "id",
  "name",
  "adset_id",
  "campaign_id",
  "effective_status",
  "status",
  "created_time",
  "creative{id,title,body,thumbnail_url,image_url,video_id,object_type,call_to_action_type,url_tags,object_story_spec}",
].join(",");
const INSIGHT_FIELDS = "ad_id,date_start,spend,impressions,inline_link_clicks,reach,actions,action_values,video_play_actions";

/** Deleted ads still have spend history, so include every status when listing. */
const ALL_STATUSES = JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "DELETED", "IN_PROCESS", "WITH_ISSUES", "DISAPPROVED", "PENDING_REVIEW", "PREAPPROVED", "PENDING_BILLING_INFO"] }]);

export function isoDay(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`Not a YYYY-MM-DD date: ${s}`);
  return s;
}

/** Split [since, until] into consecutive windows of at most `days` days. */
export function dateWindows(since: string, until: string, days: number): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  const end = Date.parse(`${until}T00:00:00Z`);
  for (let t = Date.parse(`${since}T00:00:00Z`); t <= end; t += days * 86_400_000) {
    const stop = Math.min(end, t + (days - 1) * 86_400_000);
    out.push({ since: new Date(t).toISOString().slice(0, 10), until: new Date(stop).toISOString().slice(0, 10) });
  }
  return out;
}

export async function syncMeta(deps: { client: MetaClient; store: MetaStore; now?: () => Date }, opts: { accountId: string; since: string; until: string; dryRun?: boolean }): Promise<SyncSummary> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const act = `act_${bareAccountId(opts.accountId)}`;
  const since = isoDay(opts.since);
  const until = isoDay(opts.until);
  const { client, store } = deps;

  const account = mapAccount(await client.getOne(act, { fields: "id,account_id,name,currency,timezone_name" }, accountSchema));
  const campaigns = (await client.getAll(`${act}/campaigns`, { fields: "id,name,effective_status,status,objective,daily_budget", filtering: ALL_STATUSES, limit: "200" }, campaignSchema)).map((c) => mapCampaign(c, account.id, now));
  const adSets = (await client.getAll(`${act}/adsets`, { fields: "id,name,campaign_id,effective_status,status,daily_budget", filtering: ALL_STATUSES, limit: "200" }, adSetSchema)).map((s) => mapAdSet(s, now));
  const ads = (await client.getAll(`${act}/ads`, { fields: AD_FIELDS, filtering: ALL_STATUSES, limit: "25" }, adSchema)).map((a) => mapAd(a, now));
  // Daily ad-level rows for a long range are too much for one request, so ask a week at a time.
  const insights: InsightRow[] = [];
  for (const w of dateWindows(since, until, 7)) {
    const rows = await client.getAll(`${act}/insights`, { level: "ad", time_increment: "1", time_range: JSON.stringify(w), fields: INSIGHT_FIELDS, limit: "100" }, insightSchema);
    for (const r of rows) insights.push(mapInsight(r, now));
  }

  // Meta's own account-level spend per day, to check the ad-level rows add up to what Ads Manager shows.
  const accountDaily: AccountDailyRow[] = [];
  for (const w of dateWindows(since, until, 31)) {
    const rows = await client.getAll(`${act}/insights`, { level: "account", time_increment: "1", time_range: JSON.stringify(w), fields: "spend,date_start", limit: "100" }, accountSpendSchema);
    for (const r of rows) accountDaily.push({ platform: "meta", account_id: account.id, date: r.date_start, spend: money(r.spend), updated_at: now });
  }

  // Keep the hierarchy consistent: children whose parent wasn't returned are skipped, not guessed.
  const campaignIds = new Set(campaigns.map((c) => c.id));
  const keptSets = adSets.filter((s) => campaignIds.has(s.campaign_id));
  const setIds = new Set(keptSets.map((s) => s.id));
  const keptAds = ads.filter((a) => setIds.has(a.ad_group_id));
  const adIds = new Set(keptAds.map((a) => a.id));
  const keptInsights = insights.filter((i) => adIds.has(i.ad_id));

  if (!opts.dryRun) {
    await store.upsertAccount(account);
    await store.upsertCampaigns(campaigns);
    await store.upsertAdGroups(keptSets);
    await store.upsertAds(keptAds);
    await store.upsertInsights(keptInsights);
    await store.upsertAccountDaily(accountDaily);
    // Stamped last, so "synced at" only moves once everything above is saved.
    await store.upsertAccount({ ...account, synced_at: now });
  }

  return {
    account: account.name ?? account.id,
    campaigns: campaigns.length,
    adSets: keptSets.length,
    ads: keptAds.length,
    insightRows: keptInsights.length,
    skippedInsights: insights.length - keptInsights.length,
    spend: Math.round(keptInsights.reduce((t, i) => t + i.spend, 0) * 100) / 100,
    accountSpend: Math.round(accountDaily.reduce((t, d) => t + d.spend, 0) * 100) / 100,
    since,
    until,
    dryRun: !!opts.dryRun,
  };
}

// ─── Ad previews ─────────────────────────────────────────────────────────────

/** Placements Meta can render an exact preview for, with your Page name and profile picture. */
export const PREVIEW_FORMATS = {
  MOBILE_FEED_STANDARD: "Facebook feed",
  INSTAGRAM_STANDARD: "Instagram feed",
  INSTAGRAM_REELS: "Reels",
  INSTAGRAM_STORY: "Stories",
} as const;
export type PreviewFormat = keyof typeof PREVIEW_FORMATS;
export const isPreviewFormat = (v: unknown): v is PreviewFormat => typeof v === "string" && v in PREVIEW_FORMATS;

export type PreviewFrame = { src: string; width: number; height: number };

/**
 * The iframe Meta's /previews endpoint returns, reduced to its src and size. Only https URLs on
 * facebook.com are accepted, so nothing else can be embedded through this.
 */
export function parsePreviewIframe(body: string): PreviewFrame | null {
  const raw = body.match(/src="([^"]+)"/)?.[1];
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !(url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"))) return null;
  const size = (name: string, fallback: number) => {
    const n = Number(body.match(new RegExp(`${name}="?(\\d+)`))?.[1]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return { src: url.toString(), width: size("width", 335), height: size("height", 560) };
}

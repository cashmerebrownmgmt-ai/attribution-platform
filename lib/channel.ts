/**
 * Channel classification, table-driven. Order matters: the first matching rule wins.
 * See docs/phase-1-spec.md §6.
 */

export type Channel =
  | "paid_search"
  | "paid_social"
  | "organic_search"
  | "organic_social"
  | "email"
  | "sms"
  | "affiliate"
  | "referral"
  | "other_campaign"
  | "direct";

export type SourceSignals = {
  utm_source?: string | null;
  utm_medium?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
  referrer?: string | null;
};

const PAID_SEARCH_MEDIUMS = ["cpc", "ppc", "paid", "paidsearch", "paid_search", "sem"];
const PAID_SOCIAL_MEDIUMS = ["paid_social", "paidsocial", "paid-social", "social_paid", "cpm", "social-ads"];
const SOCIAL_MEDIUMS = ["social", "organic_social", "social-network", "social-media", "sm"];

const SEARCH_ENGINES = ["google.", "bing.com", "yahoo.", "duckduckgo.com", "baidu.com", "yandex.", "ecosia.org", "search.brave.com"];
const SOCIAL_SITES = [
  "facebook.com", "fb.com", "instagram.com", "t.co", "twitter.com", "x.com", "tiktok.com", "pinterest.",
  "linkedin.com", "lnkd.in", "reddit.com", "youtube.com", "youtu.be", "snapchat.com", "threads.net",
];
const SOCIAL_SOURCES = ["facebook", "fb", "instagram", "ig", "meta", "tiktok", "pinterest", "twitter", "x", "snapchat", "youtube", "linkedin", "reddit"];
const SEARCH_SOURCES = ["google", "bing", "microsoft", "yahoo", "duckduckgo"];

function host(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const hostMatches = (h: string, patterns: string[]) =>
  patterns.some((p) => (p.endsWith(".") ? h.includes(p) : h === p || h.endsWith(`.${p}`)));

export function classifyChannel(s: SourceSignals): Channel {
  const medium = s.utm_medium?.trim().toLowerCase() ?? "";
  const source = s.utm_source?.trim().toLowerCase() ?? "";
  const ref = host(s.referrer);

  if (s.gclid || s.msclkid) return "paid_search";
  if (s.ttclid) return "paid_social";
  if (PAID_SOCIAL_MEDIUMS.includes(medium)) return "paid_social";
  if (PAID_SEARCH_MEDIUMS.includes(medium)) {
    // "cpc" from a social network is a paid social ad, not search.
    return SOCIAL_SOURCES.includes(source) ? "paid_social" : "paid_search";
  }
  if (medium === "email" || medium === "e-mail" || source === "klaviyo") return "email";
  if (medium === "sms" || medium === "text") return "sms";
  if (medium === "affiliate" || medium === "partner") return "affiliate";
  if (SOCIAL_MEDIUMS.includes(medium)) return "organic_social";
  if (medium === "organic" && SEARCH_SOURCES.includes(source)) return "organic_search";
  if (medium === "referral") return "referral";
  // Facebook adds fbclid to organic link shares too, so fbclid alone isn't proof of an ad.
  if (s.fbclid) return "organic_social";
  if (source) {
    if (SOCIAL_SOURCES.includes(source)) return "organic_social";
    if (SEARCH_SOURCES.includes(source)) return "organic_search";
    return "other_campaign";
  }
  if (ref) {
    if (hostMatches(ref, SEARCH_ENGINES)) return "organic_search";
    if (hostMatches(ref, SOCIAL_SITES)) return "organic_social";
    return "referral";
  }
  return "direct";
}

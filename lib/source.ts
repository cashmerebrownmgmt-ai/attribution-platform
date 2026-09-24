/**
 * Marketing-source parsing shared by the collect endpoint and the tracker.
 * Pure and dependency-free so it can be bundled into the storefront script.
 */

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export const CLICK_ID_KEYS = ["gclid", "fbclid", "ttclid", "msclkid"] as const;

type UtmKey = (typeof UTM_KEYS)[number];
type ClickIdKey = (typeof CLICK_ID_KEYS)[number];

export type SourceFields = { [K in UtmKey | ClickIdKey]: string | null } & {
  referrer: string | null;
};

// Referrers that are part of the purchase flow rather than a marketing source.
const INTERNAL_REFERRER_SUFFIXES = [
  "myshopify.com",
  "shopify.com",
  "shop.app",
  "paypal.com",
  "stripe.com",
  "klarna.com",
  "afterpay.com",
  "affirm.com",
];

const MAX_PARAM_LENGTH = 500;

function safeUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/** Strip "www." so example.com and www.example.com count as the same site. */
function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * True when the referrer is a different site from the page and not part of checkout/payment.
 * `storeHosts` lets the storefront's other domains (e.g. the myshopify domain) count as internal.
 */
export function isExternalReferrer(pageUrl: string, referrer: string | null, storeHosts: string[] = []): boolean {
  const ref = safeUrl(referrer);
  if (!ref || !/^https?:$/.test(ref.protocol)) return false;
  const refHost = bareHost(ref.hostname);
  const page = safeUrl(pageUrl);
  const internal = [page ? bareHost(page.hostname) : "", ...storeHosts.map(bareHost)].filter(Boolean);
  if (internal.some((h) => refHost === h)) return false;
  return !INTERNAL_REFERRER_SUFFIXES.some((s) => hostMatches(refHost, s));
}

/** Pull UTMs, ad click IDs and the external referrer out of a page view. */
export function parseSource(pageUrl: string, referrer: string | null, storeHosts: string[] = []): SourceFields {
  const params = safeUrl(pageUrl)?.searchParams;
  const read = (key: string) => {
    const v = params?.get(key)?.trim();
    return v ? v.slice(0, MAX_PARAM_LENGTH) : null;
  };
  const fields = { referrer: isExternalReferrer(pageUrl, referrer, storeHosts) ? referrer : null } as SourceFields;
  for (const key of UTM_KEYS) fields[key] = read(key);
  for (const key of CLICK_ID_KEYS) fields[key] = read(key);
  return fields;
}

/** A touchpoint is any event that carries a marketing source. */
export function isTouchpoint(source: SourceFields): boolean {
  return [...UTM_KEYS, ...CLICK_ID_KEYS, "referrer" as const].some((k) => source[k] !== null);
}

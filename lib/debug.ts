/** Pure helpers for the debug pages. */

export type SearchTarget =
  | { kind: "order_name"; value: string }
  | { kind: "order_id"; value: string }
  | { kind: "visitor"; value: string }
  | { kind: "checkout"; value: string }
  | { kind: "none" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Work out what the search box holds: "#1001", "1001", an order ID, a visitor ID or a checkout token. */
export function parseSearch(q: string | null | undefined): SearchTarget {
  const v = q?.trim() ?? "";
  if (!v) return { kind: "none" };
  if (UUID_RE.test(v)) return { kind: "visitor", value: v.toLowerCase() };
  const gid = v.match(/^gid:\/\/shopify\/Order\/(\d+)$/);
  if (gid) return { kind: "order_id", value: gid[1] };
  if (/^#?\d{1,9}$/.test(v)) return { kind: "order_name", value: v.startsWith("#") ? v : `#${v}` };
  if (/^\d{10,}$/.test(v)) return { kind: "order_id", value: v };
  if (/^[A-Za-z0-9_-]{8,128}$/.test(v)) return { kind: "checkout", value: v };
  return { kind: "none" };
}

export type MatchStats = { total: number; matched: number; rate: number | null; byMethod: Record<string, number> };

/** Share of orders stitched to a visitor (any method other than "none") since `since`. */
export function matchStats(orders: { created_at: string; stitch_method: string }[], since: Date): MatchStats {
  const inRange = orders.filter((o) => Date.parse(o.created_at) >= since.getTime());
  const byMethod: Record<string, number> = {};
  for (const o of inRange) byMethod[o.stitch_method] = (byMethod[o.stitch_method] ?? 0) + 1;
  const matched = inRange.length - (byMethod.none ?? 0);
  return { total: inRange.length, matched, rate: inRange.length ? matched / inRange.length : null, byMethod };
}

export function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 1000) / 10}%`;
}

export function formatMoney(amount: string | number | null, currency: string | null): string {
  if (amount === null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export const METHOD_LABELS: Record<string, string> = {
  cart_attribute: "Cart attribute",
  checkout_token: "Checkout token",
  customer_history: "Customer history",
  none: "Not matched",
};

export const CHANNEL_LABELS: Record<string, string> = {
  paid_search: "Paid search",
  paid_social: "Paid social",
  organic_search: "Organic search",
  organic_social: "Organic social",
  email: "Email",
  sms: "SMS",
  affiliate: "Affiliate",
  referral: "Referral",
  other_campaign: "Other campaign",
  direct: "Direct",
};

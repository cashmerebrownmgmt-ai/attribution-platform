/**
 * Shopify's own session analytics via ShopifyQL, for side-by-side comparison with our tracking.
 * Needs the read_reports scope (and protected customer data access) on the Shopify app.
 */
import type { DateRange } from "./metrics/compute";

export type ShopifySessionTotals = {
  sessions: number | null;
  visitors: number | null;
  cartAdditions: number | null;
  reachedCheckout: number | null;
  completedCheckout: number | null;
  conversionRate: number | null;
};

export const Q_SHOPIFYQL = `query ShopifySessions($query: String!) {
  shopifyqlQuery(query: $query) {
    tableData { columns { name dataType displayName } rows }
    parseErrors
  }
}`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function sessionsQuery(r: DateRange): string {
  if (!DATE.test(r.from) || !DATE.test(r.to)) throw new Error("Invalid date range");
  return `FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, conversion_rate WHERE human_or_bot_session = 'human' SINCE ${r.from} UNTIL ${r.to}`;
}

type TableData = { columns: { name: string }[]; rows: unknown };

/** Rows may come back as objects keyed by column name or as arrays in column order. */
export function parseTotals(t: TableData | null | undefined): ShopifySessionTotals | null {
  if (!t) return null;
  const rows = (typeof t.rows === "string" ? JSON.parse(t.rows) : t.rows) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0];
  const get = (name: string): number | null => {
    let v: unknown;
    if (Array.isArray(first)) v = first[t.columns.findIndex((c) => c.name === name)];
    else if (first && typeof first === "object") v = (first as Record<string, unknown>)[name];
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const rate = get("conversion_rate");
  return {
    sessions: get("sessions"),
    visitors: get("online_store_visitors"),
    cartAdditions: get("sessions_with_cart_additions"),
    reachedCheckout: get("sessions_that_reached_checkout"),
    completedCheckout: get("sessions_that_completed_checkout"),
    // Shopify may report conversion as a percentage (2.5) or a fraction (0.025).
    conversionRate: rate === null ? null : rate > 1 ? rate / 100 : rate,
  };
}

export type ComparisonResult =
  | { status: "ok"; totals: ShopifySessionTotals }
  | { status: "not_configured" }
  | { status: "no_access"; message: string }
  | { status: "error"; message: string };

/** Classify a failure: missing scope / protected data access vs anything else. */
export function classifyError(message: string): ComparisonResult {
  return /access denied|read_reports|scope|protected customer data|not approved|forbidden|403/i.test(message)
    ? { status: "no_access", message }
    : { status: "error", message };
}

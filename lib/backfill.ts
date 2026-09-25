/**
 * Historical order import from the Admin GraphQL API. Mapping and the paging loop are pure, with
 * the Shopify client and storage injected. See docs/phase-1-spec.md §7.
 */
import type { OrderItemRow, OrderRow } from "./shopify";

const ORDER_FIELDS = `
      legacyResourceId name createdAt updatedAt cancelledAt displayFinancialStatus sourceName currencyCode test
      totalPriceSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } }
      subtotalPriceSet { shopMoney { amount } }
      customAttributes { key value }`;

/** Full query (needs read_customers + read_products for customer and product IDs). */
export const Q_ORDERS_FULL = `query BackfillOrders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {${ORDER_FIELDS}
      customer { legacyResourceId }
      lineItems(first: 50) { nodes { id title variantTitle sku quantity originalUnitPriceSet { shopMoney { amount } } product { legacyResourceId } variant { legacyResourceId } } }
    }
  }
}`;

/** Fallback that needs only read_orders. */
export const Q_ORDERS_BASIC = `query BackfillOrdersBasic($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {${ORDER_FIELDS}
      lineItems(first: 50) { nodes { id title variantTitle sku quantity originalUnitPriceSet { shopMoney { amount } } } }
    }
  }
}`;

type Money = { shopMoney: { amount: string } } | null;
export type GqlOrder = {
  legacyResourceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  sourceName: string | null;
  currencyCode: string;
  test?: boolean;
  totalPriceSet: Money;
  currentTotalPriceSet?: Money;
  subtotalPriceSet: Money;
  customAttributes: { key: string; value: string | null }[];
  customer?: { legacyResourceId: string } | null;
  lineItems: {
    nodes: {
      id: string;
      title: string;
      variantTitle: string | null;
      sku: string | null;
      quantity: number;
      originalUnitPriceSet: Money;
      product?: { legacyResourceId: string } | null;
      variant?: { legacyResourceId: string } | null;
    }[];
  };
};

const gidTail = (gid: string) => gid.split("/").pop() ?? gid;

export function mapOrder(o: GqlOrder): { order: OrderRow; items: OrderItemRow[] } {
  return {
    order: {
      id: o.legacyResourceId,
      name: o.name,
      created_at: o.createdAt,
      total_price: o.totalPriceSet?.shopMoney.amount ?? null,
      current_total_price: o.currentTotalPriceSet?.shopMoney.amount ?? null,
      subtotal_price: o.subtotalPriceSet?.shopMoney.amount ?? null,
      currency: o.currencyCode,
      financial_status: o.displayFinancialStatus?.toLowerCase() ?? null,
      cancelled_at: o.cancelledAt,
      test: o.test ?? false,
      checkout_token: null,
      cart_token: null,
      customer_id: o.customer?.legacyResourceId ?? null,
      email_hash: null,
      landing_site: null,
      referring_site: null,
      source_name: o.sourceName,
      note_attributes: o.customAttributes.map((a) => ({ name: a.key, value: a.value ?? "" })),
      ingested_via: "backfill",
      shopify_updated_at: o.updatedAt,
    },
    items: o.lineItems.nodes.map((l) => ({
      line_id: gidTail(l.id),
      product_id: l.product?.legacyResourceId ?? null,
      variant_id: l.variant?.legacyResourceId ?? null,
      title: l.title,
      variant_title: l.variantTitle,
      sku: l.sku,
      quantity: l.quantity,
      price: l.originalUnitPriceSet?.shopMoney.amount ?? null,
    })),
  };
}

export function ordersSearch(since: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since must be YYYY-MM-DD");
  return `created_at:>=${since}`;
}

export type BackfillDeps = {
  fetchPage: (query: string, after: string | null, full: boolean) => Promise<{ nodes: GqlOrder[]; hasNextPage: boolean; endCursor: string | null }>;
  save: (order: OrderRow, items: OrderItemRow[]) => Promise<void>;
  stitch: (orderId: string) => Promise<string>;
  log: (line: string) => void;
};

export type BackfillSummary = { orders: number; pages: number; byMethod: Record<string, number>; lastCursor: string | null; usedFullQuery: boolean };

const isAccessError = (e: unknown) => /access denied|read_customers|read_products|scope/i.test(e instanceof Error ? e.message : String(e));

/** Page through orders since `since`, saving and stitching each. Resumable via `after`. */
export async function runBackfill(deps: BackfillDeps, opts: { since: string; after?: string | null; dryRun?: boolean; maxPages?: number }): Promise<BackfillSummary> {
  const query = ordersSearch(opts.since);
  const summary: BackfillSummary = { orders: 0, pages: 0, byMethod: {}, lastCursor: opts.after ?? null, usedFullQuery: true };
  let after = opts.after ?? null;
  for (let page = 0; page < (opts.maxPages ?? 10_000); page++) {
    let res;
    try {
      res = await deps.fetchPage(query, after, summary.usedFullQuery);
    } catch (e) {
      if (!summary.usedFullQuery || !isAccessError(e)) throw e;
      deps.log("No read_customers/read_products access: importing without customer and product IDs.");
      summary.usedFullQuery = false;
      res = await deps.fetchPage(query, after, false);
    }
    summary.pages += 1;
    for (const node of res.nodes) {
      const { order, items } = mapOrder(node);
      summary.orders += 1;
      if (opts.dryRun) continue;
      await deps.save(order, items);
      const method = await deps.stitch(order.id);
      summary.byMethod[method] = (summary.byMethod[method] ?? 0) + 1;
    }
    after = res.endCursor;
    summary.lastCursor = after;
    deps.log(`page ${summary.pages}: ${summary.orders} orders so far (resume with --after ${after ?? "-"})`);
    if (!res.hasNextPage) break;
  }
  return summary;
}

import { describe, expect, it, vi } from "vitest";
import { mapOrder, ordersSearch, runBackfill, type GqlOrder } from "@/lib/backfill";

const node = (id: string, o: Partial<GqlOrder> = {}): GqlOrder => ({
  legacyResourceId: id, name: `#${id}`, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:05:00Z", cancelledAt: null,
  displayFinancialStatus: "PAID", sourceName: "web", currencyCode: "USD",
  totalPriceSet: { shopMoney: { amount: "29.99" } }, subtotalPriceSet: { shopMoney: { amount: "29.99" } },
  customAttributes: [{ key: "_ap_vid", value: "11111111-1111-4111-8111-111111111111" }],
  customer: { legacyResourceId: "77" },
  lineItems: { nodes: [{ id: "gid://shopify/LineItem/555", title: "808 Essentials", variantTitle: null, sku: "808", quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "29.99" } }, product: { legacyResourceId: "9" }, variant: null }] },
  ...o,
});

describe("mapOrder", () => {
  it("keeps the total after refunds and the test-order flag", () => {
    const { order } = mapOrder(node("1002", { test: true, currentTotalPriceSet: { shopMoney: { amount: "9.99" } } }));
    expect(order).toMatchObject({ total_price: "29.99", current_total_price: "9.99", test: true });
    expect(mapOrder(node("1003")).order).toMatchObject({ current_total_price: null, test: false });
  });

  it("maps a GraphQL order and its line items to rows", () => {
    const { order, items } = mapOrder(node("1001"));
    expect(order).toMatchObject({ id: "1001", total_price: "29.99", financial_status: "paid", customer_id: "77", ingested_via: "backfill", shopify_updated_at: "2026-09-01T10:05:00Z", note_attributes: [{ name: "_ap_vid", value: "11111111-1111-4111-8111-111111111111" }] });
    expect(items).toEqual([{ line_id: "555", product_id: "9", variant_id: null, title: "808 Essentials", variant_title: null, sku: "808", quantity: 1, price: "29.99" }]);
  });
  it("works without customer/product access", () => {
    const { order, items } = mapOrder(node("2", { customer: undefined, lineItems: { nodes: [{ id: "gid://shopify/LineItem/1", title: "Kit", variantTitle: null, sku: null, quantity: 2, originalUnitPriceSet: null }] } }));
    expect(order.customer_id).toBeNull();
    expect(items[0]).toMatchObject({ product_id: null, quantity: 2, price: null });
  });
});

describe("runBackfill", () => {
  const log = () => {};
  it("pages until done, saving and stitching every order", async () => {
    const pages = [
      { nodes: [node("1"), node("2")], hasNextPage: true, endCursor: "c1" },
      { nodes: [node("3")], hasNextPage: false, endCursor: "c2" },
    ];
    const fetchPage = vi.fn(async (_q: string, after: string | null) => pages[after === null ? 0 : 1]);
    const save = vi.fn(async () => {});
    const stitch = vi.fn(async (id: string) => (id === "1" ? "cart_attribute" : "none"));
    const s = await runBackfill({ fetchPage, save, stitch, log }, { since: "2026-01-01" });
    expect(s).toMatchObject({ orders: 3, pages: 2, lastCursor: "c2", byMethod: { cart_attribute: 1, none: 2 } });
    expect(fetchPage.mock.calls[0][0]).toBe("created_at:>=2026-01-01");
    expect(fetchPage.mock.calls[1][1]).toBe("c1");
  });
  it("writes nothing in a dry run", async () => {
    const save = vi.fn(async () => {});
    const s = await runBackfill({ fetchPage: async () => ({ nodes: [node("1")], hasNextPage: false, endCursor: null }), save, stitch: async () => "none", log }, { since: "2026-01-01", dryRun: true });
    expect(s.orders).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });
  it("falls back to the basic query when customer/product access is missing", async () => {
    const fetchPage = vi.fn(async (_q: string, _a: string | null, full: boolean) => {
      if (full) throw new Error("Access denied for customer field. Required access: read_customers");
      return { nodes: [node("1")], hasNextPage: false, endCursor: null };
    });
    const s = await runBackfill({ fetchPage, save: async () => {}, stitch: async () => "none", log }, { since: "2026-01-01" });
    expect(s.usedFullQuery).toBe(false);
    expect(s.orders).toBe(1);
  });
  it("resumes from a cursor and rejects bad dates", async () => {
    const fetchPage = vi.fn(async (_q: string, _after: string | null) => ({ nodes: [] as never[], hasNextPage: false, endCursor: null }));
    await runBackfill({ fetchPage, save: async () => {}, stitch: async () => "none", log }, { since: "2026-01-01", after: "abc" });
    expect(fetchPage.mock.calls[0][1]).toBe("abc");
    expect(() => ordersSearch("2026-01-01 OR x")).toThrow();
  });
});

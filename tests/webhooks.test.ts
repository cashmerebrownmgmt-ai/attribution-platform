import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signShopifyBody } from "@/lib/hmac";
import { hashEmail } from "@/lib/privacy";
import type { OrderRow } from "@/lib/shopify";
import { handleShopifyWebhook, type WebhookDeps } from "@/lib/webhooks";

const SECRET = "shpss_test_secret";
const SHOP = "test-store.myshopify.com";
const ORDER_JSON = readFileSync(join(__dirname, "fixtures", "order.json"), "utf8");

type Call = { webhookId: string; error: string | null };

let claimed: Map<string, boolean>; // webhookId -> processed
let finished: Call[];
let orders: OrderRow[];
let redactions: unknown[];
let afterOrder: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
let deps: WebhookDeps;

beforeEach(() => {
  claimed = new Map();
  finished = [];
  orders = [];
  redactions = [];
  afterOrder = vi.fn(async () => {});
  deps = {
    config: { clientSecret: SECRET, shopDomain: SHOP },
    afterOrder,
    log: () => {},
    store: {
      claim: async (id) => {
        const processed = claimed.get(id);
        if (processed === undefined) claimed.set(id, false);
        return processed !== true;
      },
      finish: async (id, error) => {
        finished.push({ webhookId: id, error });
        if (!error) claimed.set(id, true);
      },
      upsertOrder: async (row) => void orders.push(row),
      redactCustomer: async (...args) => void redactions.push(["customer", ...args]),
      redactShop: async () => void redactions.push(["shop"]),
    },
  };
});

function delivery(topic: string, body: string, headers: Record<string, string | null> = {}) {
  const h: Record<string, string> = {};
  const all: Record<string, string | null> = {
    "content-type": "application/json",
    "x-shopify-topic": topic,
    "x-shopify-shop-domain": SHOP,
    "x-shopify-webhook-id": `wh-${topic}-1`,
    "x-shopify-hmac-sha256": signShopifyBody(body, SECRET),
    ...headers,
  };
  for (const [k, v] of Object.entries(all)) if (v !== null) h[k] = v;
  return new Request("https://app.example.com/api/webhooks/shopify", { method: "POST", headers: h, body });
}

describe("POST /api/webhooks/shopify", () => {
  it.each(["orders/create", "orders/updated", "orders/paid", "orders/cancelled"])(
    "%s saves the order, runs stitching and marks the delivery processed",
    async (topic) => {
      const res = await handleShopifyWebhook(delivery(topic, ORDER_JSON), deps);
      expect(res.status).toBe(200);
      expect(orders).toHaveLength(1);
      expect(afterOrder).toHaveBeenCalledWith("5801234567890");
      expect(finished).toEqual([{ webhookId: `wh-${topic}-1`, error: null }]);
    },
  );

  it("maps the order and never keeps raw personal data", async () => {
    await handleShopifyWebhook(delivery("orders/create", ORDER_JSON), deps);
    const row = orders[0];
    expect(row).toMatchObject({
      id: "5801234567890",
      name: "#1001",
      total_price: "84.50",
      subtotal_price: "75.00",
      currency: "USD",
      financial_status: "paid",
      checkout_token: "b1946ac92492d2347c6235b4d2611184",
      customer_id: "7209876543210",
      email_hash: hashEmail("jane.doe@example.com"),
      ingested_via: "webhook",
      shopify_updated_at: "2026-09-24T14:05:13-04:00",
      note_attributes: [
        { name: "_ap_vid", value: "11111111-1111-4111-8111-111111111111" },
        { name: "gift_note", value: "Happy birthday" },
      ],
    });
    const stored = JSON.stringify(row).toLowerCase();
    for (const pii of ["jane", "doe@", "main st", "toronto"]) expect(stored).not.toContain(pii);
  });

  it("rejects a tampered body, a missing signature and the wrong secret", async () => {
    const tampered = delivery("orders/create", ORDER_JSON.replace("84.50", "0.01"), {
      "x-shopify-hmac-sha256": signShopifyBody(ORDER_JSON, SECRET),
    });
    expect((await handleShopifyWebhook(tampered, deps)).status).toBe(401);
    expect((await handleShopifyWebhook(delivery("orders/create", ORDER_JSON, { "x-shopify-hmac-sha256": null }), deps)).status).toBe(401);
    const wrongKey = delivery("orders/create", ORDER_JSON, { "x-shopify-hmac-sha256": signShopifyBody(ORDER_JSON, "nope") });
    expect((await handleShopifyWebhook(wrongKey, deps)).status).toBe(401);
    expect(orders).toHaveLength(0);
    expect(claimed.size).toBe(0);
  });

  it("rejects a delivery for a different shop", async () => {
    const res = await handleShopifyWebhook(delivery("orders/create", ORDER_JSON, { "x-shopify-shop-domain": "other.myshopify.com" }), deps);
    expect(res.status).toBe(401);
    expect(orders).toHaveLength(0);
  });

  it("returns 400 when the webhook ID or topic is missing", async () => {
    expect((await handleShopifyWebhook(delivery("orders/create", ORDER_JSON, { "x-shopify-webhook-id": null }), deps)).status).toBe(400);
  });

  it("skips a duplicate delivery that was already processed", async () => {
    await handleShopifyWebhook(delivery("orders/create", ORDER_JSON), deps);
    const res = await handleShopifyWebhook(delivery("orders/create", ORDER_JSON), deps);
    expect(res.status).toBe(200);
    expect(orders).toHaveLength(1);
  });

  it("returns 500 and records the error so Shopify retries; the retry is processed", async () => {
    deps.store.upsertOrder = async () => {
      throw new Error("db down");
    };
    const first = await handleShopifyWebhook(delivery("orders/create", ORDER_JSON), deps);
    expect(first.status).toBe(500);
    expect(finished).toEqual([{ webhookId: "wh-orders/create-1", error: "db down" }]);

    deps.store.upsertOrder = async (row) => void orders.push(row);
    const retry = await handleShopifyWebhook(delivery("orders/create", ORDER_JSON), deps);
    expect(retry.status).toBe(200);
    expect(orders).toHaveLength(1);
  });

  it("records an invalid order payload as an error", async () => {
    const res = await handleShopifyWebhook(delivery("orders/create", '{"name":"#1"}'), deps);
    expect(res.status).toBe(500);
    expect(finished[0].error).toBeTruthy();
  });

  it("customers/redact strips the customer's identifiers", async () => {
    const body = JSON.stringify({
      shop_id: 1,
      shop_domain: SHOP,
      customer: { id: 7209876543210, email: "Jane.Doe@example.com", phone: null },
      orders_to_redact: [5801234567890, 5801234567891],
    });
    expect((await handleShopifyWebhook(delivery("customers/redact", body), deps)).status).toBe(200);
    expect(redactions).toEqual([
      ["customer", "7209876543210", hashEmail("jane.doe@example.com"), ["5801234567890", "5801234567891"]],
    ]);
  });

  it("shop/redact deletes store data", async () => {
    const body = JSON.stringify({ shop_id: 1, shop_domain: SHOP });
    expect((await handleShopifyWebhook(delivery("shop/redact", body), deps)).status).toBe(200);
    expect(redactions).toEqual([["shop"]]);
  });

  it("customers/data_request and unhandled topics are acknowledged and logged as processed", async () => {
    for (const topic of ["customers/data_request", "refunds/create"]) {
      expect((await handleShopifyWebhook(delivery(topic, '{"id":1}'), deps)).status).toBe(200);
    }
    expect(finished.map((f) => f.error)).toEqual([null, null]);
    expect(orders).toHaveLength(0);
  });
});

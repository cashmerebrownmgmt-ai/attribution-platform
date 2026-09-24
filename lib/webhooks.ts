import { z } from "zod";
import { verifyShopifyHmac } from "./hmac";
import { hashEmail } from "./privacy";
import { ORDER_TOPICS, orderPayload, toOrderRow, type OrderRow } from "./shopify";

/** Request handling for POST /api/webhooks/shopify. Storage is injected so this stays testable. */

export type WebhookStore = {
  /** Record the delivery; true if it should be processed (new, or a retry of a failure). */
  claim: (webhookId: string, topic: string, shopDomain: string) => Promise<boolean>;
  finish: (webhookId: string, error: string | null) => Promise<void>;
  upsertOrder: (row: OrderRow) => Promise<void>;
  redactCustomer: (customerId: string | null, emailHash: string | null, orderIds: string[]) => Promise<void>;
  redactShop: () => Promise<void>;
};

export type WebhookDeps = {
  config: { clientSecret: string; shopDomain: string };
  store: WebhookStore;
  /** Runs after an order is saved (stitching + attribution, step 4). */
  afterOrder?: (orderId: string) => Promise<void>;
  log?: (message: string, detail?: unknown) => void;
};

const customersRedact = z.object({
  customer: z.object({ id: z.union([z.number(), z.string()]).transform(String).nullish(), email: z.string().nullish() }),
  orders_to_redact: z.array(z.union([z.number(), z.string()]).transform(String)).nullish(),
});

async function process(topic: string, body: unknown, deps: WebhookDeps): Promise<void> {
  if (ORDER_TOPICS.has(topic)) {
    const row = toOrderRow(orderPayload.parse(body), "webhook");
    await deps.store.upsertOrder(row);
    await deps.afterOrder?.(row.id);
    return;
  }
  switch (topic) {
    case "customers/redact": {
      const p = customersRedact.parse(body);
      await deps.store.redactCustomer(p.customer.id ?? null, hashEmail(p.customer.email), p.orders_to_redact ?? []);
      return;
    }
    case "shop/redact":
      await deps.store.redactShop();
      return;
    case "customers/data_request":
      // We hold no raw personal data (emails are hashed); logged for manual follow-up.
      deps.log?.("shopify: customers/data_request received");
      return;
    default:
      // refunds/create and anything else: recorded in webhook_events, no processing yet.
      return;
  }
}

export async function handleShopifyWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const log = deps.log ?? ((m, d) => console.warn(m, d));
  // Verify against the exact bytes Shopify signed, before parsing anything.
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifyShopifyHmac(raw, req.headers.get("x-shopify-hmac-sha256"), deps.config.clientSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  const shop = req.headers.get("x-shopify-shop-domain")?.toLowerCase() ?? "";
  if (shop !== deps.config.shopDomain.toLowerCase()) {
    return new Response("unknown shop", { status: 401 });
  }

  const topic = req.headers.get("x-shopify-topic") ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id");
  if (!webhookId || !topic) return new Response("missing headers", { status: 400 });

  if (!(await deps.store.claim(webhookId, topic, shop))) {
    return new Response(null, { status: 200 }); // duplicate of a delivery already processed
  }

  try {
    await process(topic, JSON.parse(raw.toString("utf8")), deps);
    await deps.store.finish(webhookId, null);
    return new Response(null, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("shopify webhook failed", { topic, webhookId, message });
    await deps.store.finish(webhookId, message.slice(0, 1000)).catch(() => {});
    return new Response(null, { status: 500 }); // Shopify retries
  }
}

import "server-only";
import { db } from "./db";
import type { WebhookStore } from "./webhooks";

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

/** Supabase-backed storage for the Shopify webhook handler. */
export const supabaseWebhookStore: WebhookStore = {
  claim: (webhookId, topic, shopDomain) =>
    rpc<boolean>("claim_webhook", { p_webhook_id: webhookId, p_topic: topic, p_shop_domain: shopDomain }),

  async finish(webhookId, error) {
    const { error: e } = await db()
      .from("webhook_events")
      .update({ processed_at: error ? null : new Date().toISOString(), error })
      .eq("webhook_id", webhookId);
    if (e) throw new Error(`webhook_events update failed: ${e.message}`);
  },

  upsertOrder: (row) => rpc("upsert_order", { p_order: row }),

  redactCustomer: (customerId, emailHash, orderIds) =>
    rpc("redact_customer", { p_customer_id: customerId, p_email_hash: emailHash, p_order_ids: orderIds }),

  redactShop: () => rpc("redact_shop"),
};

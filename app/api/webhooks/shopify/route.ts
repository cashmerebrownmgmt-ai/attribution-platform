import { requireEnv } from "@/lib/env";
import { supabaseWebhookStore } from "@/lib/webhook-store";
import { handleShopifyWebhook } from "@/lib/webhooks";

export async function POST(req: Request) {
  return handleShopifyWebhook(req, {
    config: {
      clientSecret: requireEnv("SHOPIFY_CLIENT_SECRET"),
      shopDomain: requireEnv("SHOPIFY_SHOP_DOMAIN"),
    },
    store: supabaseWebhookStore,
  });
}

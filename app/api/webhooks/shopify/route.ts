import { stitchOrder } from "@/lib/stitch-runner";
import { supabaseStitchRepo } from "@/lib/stitch-store";
import { supabaseWebhookStore } from "@/lib/webhook-store";
import { handleShopifyWebhook } from "@/lib/webhooks";

export async function POST(req: Request) {
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  // Until the Shopify app is set up, refuse cleanly instead of erroring.
  if (!clientSecret || !shopDomain) return new Response("Shopify webhooks are not configured", { status: 503 });

  return handleShopifyWebhook(req, {
    config: { clientSecret, shopDomain },
    store: supabaseWebhookStore,
    afterOrder: async (orderId) => {
      await stitchOrder(orderId, supabaseStitchRepo);
    },
  });
}

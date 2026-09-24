/**
 * One-time Shopify setup: subscribe the store's order webhooks to the live app.
 *   npx tsx --env-file=.env.local scripts/shopify-setup.ts https://your-app.vercel.app [--dry-run]
 * Safe to re-run: existing subscriptions are left alone.
 */
import { adminClient, M_CREATE, Q_EXISTING, Q_SHOP, webhooksToCreate, type ExistingWebhook } from "../lib/shopify-admin";

async function main() {
  const [appUrl, flag] = process.argv.slice(2);
  if (!appUrl?.startsWith("https://")) throw new Error("Pass the live app URL, e.g. https://attribution-platform-sigma.vercel.app");
  const { SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;
  if (!SHOPIFY_SHOP_DOMAIN || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    throw new Error("Set SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env.local first.");
  }
  const client = adminClient({ shop: SHOPIFY_SHOP_DOMAIN, clientId: SHOPIFY_CLIENT_ID, clientSecret: SHOPIFY_CLIENT_SECRET });
  const uri = `${appUrl.replace(/\/+$/, "")}/api/webhooks/shopify`;

  const { shop } = await client.graphql<{ shop: { name: string; myshopifyDomain: string; primaryDomain: { url: string }; currencyCode: string } }>(Q_SHOP);
  console.log(`Connected to ${shop.name} (${shop.myshopifyDomain}, storefront ${shop.primaryDomain.url}, ${shop.currencyCode})`);

  const existing = (await client.graphql<{ webhookSubscriptions: { nodes: ExistingWebhook[] } }>(Q_EXISTING)).webhookSubscriptions.nodes;
  const todo = webhooksToCreate(existing, uri);
  console.log(`Webhooks → ${uri}: ${existing.filter((w) => w.uri === uri).length} already set up, ${todo.length} to create`);
  if (flag === "--dry-run") return console.log("Dry run: nothing created.", todo);

  for (const topic of todo) {
    const r = await client.graphql<{ webhookSubscriptionCreate: { webhookSubscription: ExistingWebhook | null; userErrors: { message: string }[] } }>(M_CREATE, {
      topic,
      webhookSubscription: { uri },
    });
    const errs = r.webhookSubscriptionCreate.userErrors;
    console.log(errs.length ? `  ✗ ${topic}: ${errs.map((e) => e.message).join("; ")}` : `  ✓ ${topic}`);
  }
  console.log(`\nAdd this to ALLOWED_ORIGINS in Vercel if it isn't there: ${shop.primaryDomain.url.replace(/\/$/, "")},https://${shop.myshopifyDomain}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

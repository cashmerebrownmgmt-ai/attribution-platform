/**
 * Fill Shopify journey data (first/last visit) for orders: npx tsx --env-file=.env.local scripts/journeys.ts [--since YYYY-MM-DD]
 * Default: the last 400 days. Safe to re-run; rows are replaced.
 */
import { createClient } from "@supabase/supabase-js";
import { makeJourneyStore } from "../lib/journey-store";
import { syncJourneys } from "../lib/journeys";
import { adminClient } from "../lib/shopify-admin";

const args = process.argv.slice(2);
const i = args.indexOf("--since");
const since = i >= 0 ? args[i + 1] : new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
const env = process.env;
if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Shopify and Supabase environment variables are required.");
  process.exit(1);
}

async function main() {
  const shop = adminClient({ shop: env.SHOPIFY_SHOP_DOMAIN!, clientId: env.SHOPIFY_CLIENT_ID!, clientSecret: env.SHOPIFY_CLIENT_SECRET! });
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  console.log(`Fetching Shopify journeys for orders since ${since}…`);
  const r = await syncJourneys({ graphql: shop.graphql, store: makeJourneyStore(() => db) }, { since });
  console.log(r);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

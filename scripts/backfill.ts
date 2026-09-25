/**
 * Import past Shopify orders.
 *   npx tsx --env-file=.env.local scripts/backfill.ts --since 2025-09-25 [--dry-run] [--after <cursor>]
 * Without read_all_orders, Shopify only returns the last 60 days.
 */
import { createClient } from "@supabase/supabase-js";
import { Q_ORDERS_BASIC, Q_ORDERS_FULL, runBackfill, type GqlOrder } from "../lib/backfill";
import { adminClient } from "../lib/shopify-admin";
import { makeStitchRepo } from "../lib/stitch-repo";
import { stitchOrder } from "../lib/stitch-runner";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const env = process.env;
  for (const k of ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[k]) throw new Error(`Missing ${k} in .env.local`);
  }
  const since = arg("--since") ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const dryRun = process.argv.includes("--dry-run");
  const shopify = adminClient({ shop: env.SHOPIFY_SHOP_DOMAIN!, clientId: env.SHOPIFY_CLIENT_ID!, clientSecret: env.SHOPIFY_CLIENT_SECRET! });
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const repo = makeStitchRepo(() => supabase);

  console.log(`Importing orders since ${since}${dryRun ? " (dry run: nothing is written)" : ""}…`);
  const s = await runBackfill(
    {
      fetchPage: async (query, after, full) => {
        const data = await shopify.graphql<{ orders: { nodes: GqlOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(full ? Q_ORDERS_FULL : Q_ORDERS_BASIC, { first: 100, after, query });
        return { nodes: data.orders.nodes, hasNextPage: data.orders.pageInfo.hasNextPage, endCursor: data.orders.pageInfo.endCursor };
      },
      save: async (order, items) => {
        const o = await supabase.rpc("upsert_order", { p_order: order });
        if (o.error) throw new Error(`upsert_order: ${o.error.message}`);
        const i = await supabase.rpc("replace_order_items", { p_order_id: order.id, p_items: items });
        if (i.error) throw new Error(`replace_order_items: ${i.error.message}`);
      },
      stitch: async (id) => (await stitchOrder(id, repo))?.method ?? "none",
      log: (l) => console.log(l),
    },
    { since, after: arg("--after"), dryRun },
  );
  console.log(`\nDone: ${s.orders} orders in ${s.pages} page(s).`, dryRun ? "" : "Matched by:", dryRun ? "" : s.byMethod);
  if (!s.usedFullQuery) console.log("Tip: add read_customers and read_products to the Shopify app to import customer and product IDs.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

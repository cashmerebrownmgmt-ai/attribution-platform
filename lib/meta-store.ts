import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaStore } from "./meta";

/** Supabase-backed store for the Meta sync. Takes the client so scripts can use it outside Next.js. */
export function makeMetaStore(db: () => SupabaseClient): MetaStore {
  async function upsert(table: string, rows: object[], onConflict: string) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db().from(table).upsert(rows.slice(i, i + 500), { onConflict });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    }
  }
  return {
    upsertAccount: (row) => upsert("ad_accounts", [row], "platform,id"),
    upsertCampaigns: (rows) => upsert("campaigns", rows, "platform,id"),
    upsertAdGroups: (rows) => upsert("ad_groups", rows, "platform,id"),
    upsertAds: (rows) => upsert("ads", rows, "platform,id"),
    upsertInsights: (rows) => upsert("ad_insights_daily", rows, "platform,ad_id,date"),
    upsertAccountDaily: (rows) => upsert("ad_account_daily", rows, "platform,account_id,date"),
  };
}

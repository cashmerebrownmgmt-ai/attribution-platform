import type { SupabaseClient } from "@supabase/supabase-js";
import type { JourneyRow } from "./journeys";

/** Supabase-backed storage for Shopify journeys. Takes the client so scripts can use it outside Next.js. */
export function makeJourneyStore(db: () => SupabaseClient) {
  return {
    async upsertJourneys(rows: JourneyRow[]) {
      // Journeys can only attach to orders we have; skip the rest (e.g. orders the import hasn't reached).
      const ids = rows.map((r) => r.order_id);
      const { data, error: e1 } = await db().from("orders").select("id").in("id", ids);
      if (e1) throw new Error(`orders lookup failed: ${e1.message}`);
      const known = new Set((data ?? []).map((o) => String(o.id)));
      const keep = rows.filter((r) => known.has(r.order_id));
      if (!keep.length) return;
      const { error } = await db().from("order_journeys").upsert(keep, { onConflict: "order_id" });
      if (error) throw new Error(`order_journeys upsert failed: ${error.message}`);
    },
    async lastFetchedAt(): Promise<string | null> {
      const { data } = await db().from("order_journeys").select("fetched_at").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
      return (data?.fetched_at as string | null) ?? null;
    },
  };
}

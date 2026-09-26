import "server-only";
import { db } from "./db";
import { makeJourneyStore } from "./journey-store";
import { syncJourneys } from "./journeys";
import { addDays } from "./metrics/compute";
import { adminClient } from "./shopify-admin";
import { storeToday } from "./tz";

let inFlight: Promise<"synced" | "recent" | "not_connected" | "failed"> | null = null;

/**
 * Refresh Shopify's journey data for recent orders (Shopify finishes it shortly after checkout)
 * unless the last refresh was under `minAgeMs` ago. Concurrent callers share one refresh.
 */
export function refreshJourneys(minAgeMs: number, days = 2): Promise<"synced" | "recent" | "not_connected" | "failed"> {
  const { SHOPIFY_SHOP_DOMAIN: shop, SHOPIFY_CLIENT_ID: clientId, SHOPIFY_CLIENT_SECRET: clientSecret } = process.env;
  if (!shop || !clientId || !clientSecret) return Promise.resolve("not_connected");
  inFlight ??= (async () => {
    try {
      const store = makeJourneyStore(db);
      const last = await store.lastFetchedAt();
      if (last && Date.now() - Date.parse(last) < minAgeMs) return "recent" as const;
      await syncJourneys({ graphql: adminClient({ shop, clientId, clientSecret }).graphql, store }, { since: addDays(storeToday(), -days) });
      return "synced" as const;
    } catch (e) {
      console.error("journey refresh failed:", e instanceof Error ? e.message : "");
      return "failed" as const;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

import "server-only";
import { db } from "./db";
import { addDays } from "./metrics/compute";
import { MetaApiError, metaClient, syncMeta } from "./meta";
import { makeMetaStore } from "./meta-store";
import { storeToday } from "./tz";

export type MetaRefresh = "synced" | "recent" | "not_connected" | "failed";

export const metaConnected = () => !!process.env.META_ACCESS_TOKEN && !!process.env.META_AD_ACCOUNT_ID;

/** When Meta was last pulled (null if never). */
export async function metaSyncedAt(): Promise<string | null> {
  const { data } = await db().from("ad_accounts").select("synced_at").eq("platform", "meta").order("synced_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return (data?.synced_at as string | null) ?? null;
}

let inFlight: Promise<{ status: MetaRefresh; message?: string }> | null = null;

/**
 * Pull today's and yesterday's Meta numbers unless the last pull was under `minAgeMs` ago.
 * Concurrent callers share one pull.
 */
export function refreshMeta(minAgeMs: number): Promise<{ status: MetaRefresh; message?: string }> {
  if (!metaConnected()) return Promise.resolve({ status: "not_connected" });
  inFlight ??= (async () => {
    try {
      const at = await metaSyncedAt();
      if (at && Date.now() - Date.parse(at) < minAgeMs) return { status: "recent" as const };
      const until = storeToday();
      await syncMeta(
        { client: metaClient({ token: process.env.META_ACCESS_TOKEN!, appSecret: process.env.META_APP_SECRET }), store: makeMetaStore(db) },
        { accountId: process.env.META_AD_ACCOUNT_ID!, since: addDays(until, -1), until },
      );
      return { status: "synced" as const };
    } catch (e) {
      console.error("meta refresh failed", e instanceof MetaApiError ? `${e.code ?? e.status}` : "");
      return { status: "failed" as const, message: e instanceof MetaApiError ? e.message : "Meta sync failed" };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

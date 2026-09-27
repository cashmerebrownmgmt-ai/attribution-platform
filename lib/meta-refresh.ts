import "server-only";
import { after } from "next/server";
import { db } from "./db";
import { addDays } from "./metrics/compute";
import { MetaApiError, metaClient, syncMeta, syncMetaSpend } from "./meta";
import { makeMetaStore } from "./meta-store";
import { storeToday } from "./tz";

export type MetaRefresh = "synced" | "recent" | "not_connected" | "failed";

export const metaConnected = () => !!process.env.META_ACCESS_TOKEN && !!process.env.META_AD_ACCOUNT_ID;

/** When Meta was last pulled (null if never). */
export async function metaSyncedAt(): Promise<string | null> {
  const { data } = await db().from("ad_accounts").select("synced_at").eq("platform", "meta").order("synced_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return (data?.synced_at as string | null) ?? null;
}

const FULL_EVERY_MS = 60 * 60_000;

/** When the campaign/ad list was last pulled in full (the quick refresh doesn't touch it). */
async function fullSyncedAt(): Promise<string | null> {
  const { data } = await db().from("campaigns").select("updated_at").eq("platform", "meta").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.updated_at as string | null) ?? null;
}

const client = () => metaClient({ token: process.env.META_ACCESS_TOKEN!, appSecret: process.env.META_APP_SECRET });
const failure = (e: unknown) => {
  console.error("meta refresh failed", e instanceof MetaApiError ? `${e.code ?? e.status}` : "");
  return { status: "failed" as const, message: e instanceof MetaApiError ? e.message : "Meta sync failed" };
};

let fullInFlight: Promise<void> | null = null;

/** Full pull of today's and yesterday's campaigns, ads, creatives and numbers. Concurrent callers share one. */
function fullSync(): Promise<void> {
  fullInFlight ??= (async () => {
    try {
      const until = storeToday();
      await syncMeta({ client: client(), store: makeMetaStore(db) }, { accountId: process.env.META_AD_ACCOUNT_ID!, since: addDays(until, -1), until });
    } catch (e) {
      failure(e);
    } finally {
      fullInFlight = null;
    }
  })();
  return fullInFlight;
}

/** Run after the response when inside a request; otherwise (scripts) just wait for it. */
async function inBackground(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
  } catch {
    await task();
  }
}

let inFlight: Promise<{ status: MetaRefresh; message?: string }> | null = null;

/**
 * Pull today's and yesterday's Meta numbers unless the last pull was under `minAgeMs` ago.
 * Quick: only spend and results (a second or two). The full campaign/ad/creative list follows in the
 * background when a new ad shows up or it's over an hour old. Concurrent callers share one pull.
 */
export function refreshMeta(minAgeMs: number): Promise<{ status: MetaRefresh; message?: string }> {
  if (!metaConnected()) return Promise.resolve({ status: "not_connected" });
  inFlight ??= (async () => {
    try {
      const [at, fullAt] = await Promise.all([metaSyncedAt(), fullSyncedAt()]);
      if (at && Date.now() - Date.parse(at) < minAgeMs) return { status: "recent" as const };
      const until = storeToday();
      const r = await syncMetaSpend({ client: client(), store: makeMetaStore(db) }, { accountId: process.env.META_AD_ACCOUNT_ID!, since: addDays(until, -1), until });
      if (r.unknownAds > 0 || !fullAt || Date.now() - Date.parse(fullAt) > FULL_EVERY_MS) await inBackground(fullSync);
      return { status: "synced" as const };
    } catch (e) {
      return failure(e);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

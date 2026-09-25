"use server";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { currentMode } from "@/lib/dashboard/data";
import { db } from "@/lib/db";
import { addDays } from "@/lib/metrics/compute";
import { MetaApiError, metaClient, syncMeta } from "@/lib/meta";
import { makeMetaStore } from "@/lib/meta-store";
import { storeToday } from "@/lib/tz";

export type RefreshResult = { at: string; meta: "synced" | "recent" | "not_connected" | "failed" | "demo"; message?: string };

const MIN_GAP_MS = 5 * 60_000;

/**
 * The dashboard's Refresh button. Shopify orders arrive in real time already; this also pulls
 * today's and yesterday's Meta numbers (at most every 5 minutes), then re-renders every page.
 */
export async function refreshData(): Promise<RefreshResult> {
  await requireMember("viewer", "/dashboard");
  const at = new Date().toISOString();
  const done = (r: Omit<RefreshResult, "at">): RefreshResult => {
    revalidatePath("/dashboard", "layout");
    return { at, ...r };
  };
  if ((await currentMode()) === "demo") return done({ meta: "demo" });

  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !accountId) return done({ meta: "not_connected" });

  // Every sync stamps updated_at on the rows it writes, so the newest one says when Meta last synced.
  const { data: last } = await db().from("ad_insights_daily").select("updated_at").eq("platform", "meta").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(String(last.updated_at)) < MIN_GAP_MS) return done({ meta: "recent" });

  const until = storeToday();
  try {
    await syncMeta({ client: metaClient({ token, appSecret: process.env.META_APP_SECRET }), store: makeMetaStore(db) }, { accountId, since: addDays(until, -1), until });
    return done({ meta: "synced" });
  } catch (e) {
    console.error("refresh: meta sync failed", e instanceof MetaApiError ? `${e.code ?? e.status}` : "");
    return done({ meta: "failed", message: e instanceof MetaApiError ? e.message : "Meta sync failed" });
  }
}

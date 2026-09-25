import { isCronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { MetaApiError, metaClient, syncMeta } from "@/lib/meta";
import { makeMetaStore } from "@/lib/meta-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily Meta refresh (Vercel Cron): re-pulls the last 7 days, since Meta restates recent numbers. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !accountId) return Response.json({ skipped: "Meta is not connected" });

  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  try {
    const summary = await syncMeta({ client: metaClient({ token, appSecret: process.env.META_APP_SECRET }), store: makeMetaStore(db) }, { accountId, since, until });
    return Response.json(summary);
  } catch (e) {
    const message = e instanceof MetaApiError ? `Meta API error ${e.code ?? e.status}: ${e.message}` : "Meta sync failed";
    console.error("meta-sync:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}

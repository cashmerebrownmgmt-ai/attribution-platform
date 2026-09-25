import "server-only";
import { db } from "./db";
import { demoLiveEvents } from "./demo/live";
import type { LiveEvent } from "./live";

const COLUMNS =
  "id, visitor_id, session_id, type, source, occurred_at, path, title, referrer, utm_source, utm_medium, utm_campaign, gclid, fbclid, ttclid, msclkid, country, region, city, device";

/** Events from the last `minutes` (by arrival time), newest first, capped for safety. */
export async function loadLiveEvents(mode: "live" | "demo", now: number, minutes = 30): Promise<LiveEvent[]> {
  if (mode === "demo") return demoLiveEvents(now);
  const since = new Date(now - minutes * 60_000).toISOString();
  const { data, error } = await db().from("events").select(COLUMNS).gte("received_at", since).order("received_at", { ascending: false }).limit(3000);
  if (error) throw new Error(`live events failed: ${error.message}`);
  return (data ?? []) as LiveEvent[];
}

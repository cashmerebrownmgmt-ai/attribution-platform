import "server-only";
import { z } from "zod";
import { metaClient, parseHourlySpend } from "./meta";
import { storeToday } from "./tz";

const cache = new Map<string, { at: number; hours: number[] | null }>();
const rowSchema = z.object({ spend: z.union([z.string(), z.number()]).nullish(), hourly_stats_aggregated_by_advertiser_time_zone: z.string().nullish() });

/**
 * Meta's spend by hour for one day (for single-day charts; totals keep using the daily account figure).
 * Cached briefly for today, longer for past days. Null when Meta isn't connected or can't answer.
 */
export async function metaHourlySpend(day: string): Promise<number[] | null> {
  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !accountId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ttl = day >= storeToday() ? 5 * 60_000 : 6 * 3_600_000;
  const hit = cache.get(day);
  if (hit && Date.now() - hit.at < ttl) return hit.hours;
  let hours: number[] | null = null;
  try {
    const rows = await metaClient({ token, appSecret: process.env.META_APP_SECRET }).getAll(
      `act_${accountId.replace(/^act_/, "")}/insights`,
      { level: "account", time_range: JSON.stringify({ since: day, until: day }), breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", fields: "spend", limit: "48" },
      rowSchema,
    );
    hours = parseHourlySpend(rows);
  } catch {
    hours = null;
  }
  if (cache.size > 60) cache.clear();
  cache.set(day, { at: Date.now(), hours });
  return hours;
}

import "server-only";
import { addDays, type DateRange } from "./metrics/compute";
import { db } from "./db";
import { STORE_TZ } from "./tz";
import { demoPageStats } from "./demo/pages";
import type { PageStat } from "./trends";

/** Page stats for the range plus the equally long period before it. */
export async function loadPageStats(mode: "live" | "demo", r: DateRange, today: string): Promise<PageStat[]> {
  const len = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1;
  const from = addDays(r.from, -len);
  if (mode === "demo") return demoPageStats(today).filter((s) => s.day >= from && s.day <= r.to);
  const out: PageStat[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await db()
      // Days are grouped in the store's time zone; the UTC bounds are a day wider to cover them.
      .rpc("page_stats", { p_from: `${addDays(from, -1)}T00:00:00Z`, p_to: `${addDays(r.to, 2)}T00:00:00Z`, p_tz: STORE_TZ })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`page_stats failed: ${error.message}`);
    out.push(...((data ?? []) as PageStat[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

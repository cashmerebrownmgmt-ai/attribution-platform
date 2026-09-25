import "server-only";
import { addDays, type DateRange } from "./metrics/compute";
import { db } from "./db";
import { demoSessions } from "./demo/sessions";
import type { SessionFact } from "./sessions";

let demoCache: { day: string; data: SessionFact[] } | undefined;

/** Sessions for the range plus the equally long period before it (for comparisons). */
export async function loadSessions(mode: "live" | "demo", r: DateRange, today: string): Promise<SessionFact[]> {
  const len = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1;
  const from = addDays(r.from, -len);
  if (mode === "demo") {
    if (demoCache?.day !== today) demoCache = { day: today, data: demoSessions(today) };
    return demoCache.data.filter((s) => s.started_at.slice(0, 10) >= from && s.started_at.slice(0, 10) <= r.to);
  }
  const out: SessionFact[] = [];
  for (let page = 0; page < 200; page++) {
    const { data, error } = await db()
      .rpc("session_facts", { p_from: `${from}T00:00:00Z`, p_to: `${addDays(r.to, 1)}T00:00:00Z` })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`session_facts failed: ${error.message}`);
    out.push(...((data ?? []) as SessionFact[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

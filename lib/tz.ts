/**
 * The store's time zone. Every "day" on the dashboard (Today, Yesterday, date ranges, charts, the
 * daily report) is a calendar day here, matching Shopify's reports. Shopify and the Meta ad account
 * are both set to America/New_York.
 */
export const STORE_TZ = "America/New_York";

const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
// Time-zone offsets only change on the hour, so cache by UTC hour (a few thousand entries at most).
const byHour = new Map<number, string>();

/** YYYY-MM-DD of an instant in the store's time zone. Date-only strings pass through unchanged. */
export function storeDay(at: string | number | Date): string {
  if (typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  const ms = typeof at === "number" ? at : typeof at === "string" ? Date.parse(at) : at.getTime();
  if (!Number.isFinite(ms)) return typeof at === "string" ? at.slice(0, 10) : "";
  const hour = Math.floor(ms / 3_600_000);
  let day = byHour.get(hour);
  if (day === undefined) {
    day = formatter.format(new Date(ms));
    byHour.set(hour, day);
  }
  return day;
}

/** Today's date in the store's time zone. */
export const storeToday = () => storeDay(Date.now());

const clock = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" });

/** Hours since midnight in the store's time zone, e.g. 13.5 for 1:30pm. */
export function storeHours(at: string | number | Date): number {
  const d = new Date(typeof at === "string" || typeof at === "number" ? at : at.getTime());
  const parts = clock.formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

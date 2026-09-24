/** URL ⇄ filter state for the dashboard. Pure. */
import { MODELS, type Model } from "../attribution";
import { addDays, type DateRange, type Filters } from "../metrics/compute";
import { AD_PLATFORMS, type Platform } from "../metrics/types";

export const PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "14d", label: "Last 14 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "mtd", label: "This month" },
  { id: "last_month", label: "Last month" },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];

export const MODEL_LABELS: Record<Model, string> = {
  first_touch: "First touch",
  last_touch: "Last touch",
  last_non_direct: "Last non-direct",
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  microsoft: "Microsoft",
};

export type ParsedFilters = Filters & { preset: PresetId | "custom" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDay = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Read filters from search params. `today` is the last complete-or-current day (YYYY-MM-DD).
 * Defaults: last 30 days, last non-direct, all platforms. Custom ranges are clamped to 366 days.
 */
export function parseFilters(params: Params, today: string): ParsedFilters {
  const modelParam = one(params.model);
  const model: Model = (MODELS as readonly string[]).includes(modelParam ?? "") ? (modelParam as Model) : "last_non_direct";
  const platformParam = one(params.platform);
  const platform = (AD_PLATFORMS as string[]).includes(platformParam ?? "") ? (platformParam as Platform) : "all";

  const from = one(params.from);
  const to = one(params.to);
  if (isDay(from) && isDay(to) && from <= to) {
    const clampedTo = to > today ? today : to;
    const minFrom = addDays(clampedTo, -365);
    return { range: { from: from < minFrom ? minFrom : from, to: clampedTo }, model, platform, preset: "custom" };
  }

  const presetParam = one(params.range) as PresetId | undefined;
  const preset = PRESETS.find((p) => p.id === presetParam) ?? PRESETS.find((p) => p.id === "30d")!;
  return { range: presetRange(preset.id, today), model, platform, preset: preset.id };
}

export function presetRange(id: PresetId, today: string): DateRange {
  switch (id) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "mtd":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last_month": {
      const lastDay = addDays(`${today.slice(0, 8)}01`, -1);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
    default: {
      const days = Number(id.replace("d", ""));
      return { from: addDays(today, -(days - 1)), to: today };
    }
  }
}

/** Build a query string for links that keep the current filters. */
export function filterQuery(f: ParsedFilters, overrides: Record<string, string | null> = {}): string {
  const q = new URLSearchParams();
  if (f.preset === "custom") {
    q.set("from", f.range.from);
    q.set("to", f.range.to);
  } else if (f.preset !== "30d") q.set("range", f.preset);
  if (f.model !== "last_non_direct") q.set("model", f.model);
  if (f.platform !== "all") q.set("platform", f.platform);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

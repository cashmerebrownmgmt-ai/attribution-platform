/** Name, context and analysis for any platform / campaign / ad set / ad. Pure. */
import { ctrDecay, fatigue, performance, type Filters, type Level, type PerfRow } from "../metrics/compute";
import { breakdown, type Breakdown } from "../metrics/drivers";
import { adSignal, type Signal } from "../metrics/signals";
import type { Ad, DashboardData, Platform } from "../metrics/types";
import { PLATFORM_LABELS } from "./filters";

export type EntityInfo = {
  level: Level;
  key: string;
  platform: Platform;
  name: string;
  status: string;
  /** e.g. "Meta · Prospecting – Broad" for an ad. */
  context: string;
  ad: Ad | null;
  row: PerfRow | null;
  signal: Signal | null;
  analysis: Breakdown;
};

export const LEVEL_LABELS: Record<Level, string> = { platform: "Platform", campaign: "Campaign", adGroup: "Ad set", ad: "Ad" };

export function entityInfo(data: DashboardData, f: Filters, level: Level, key: string): EntityInfo {
  const platform = key.split(":")[0] as Platform;
  const id = key.split(":")[1];
  const ad = level === "ad" ? data.ads.find((a) => a.platform === platform && a.id === id) ?? null : null;
  const campaign =
    level === "campaign" ? data.campaigns.find((c) => c.platform === platform && c.id === id) : ad ? data.campaigns.find((c) => c.platform === platform && c.id === ad.campaignId) : undefined;
  const group = level === "adGroup" ? data.adGroups.find((g) => g.platform === platform && g.id === id) : undefined;
  const groupCampaign = group ? data.campaigns.find((c) => c.platform === platform && c.id === group.campaignId) : undefined;

  const name = level === "platform" ? PLATFORM_LABELS[platform] : level === "campaign" ? campaign?.name : level === "adGroup" ? group?.name : ad?.name;
  const status = (level === "campaign" ? campaign?.status : level === "adGroup" ? group?.status : ad?.status) ?? "active";
  const context = [PLATFORM_LABELS[platform], level === "ad" ? campaign?.name : level === "adGroup" ? groupCampaign?.name : null].filter(Boolean).join(" · ");

  const row = performance(data, { ...f, platform: "all" }, level).find((r) => r.key === key) ?? null;
  let signal: Signal | null = null;
  if (ad && row) {
    const endMs = Date.parse(`${f.range.to}T23:59:59Z`);
    const ageDays = ad.launchedAt ? Math.max(0, Math.floor((endMs - Date.parse(ad.launchedAt)) / 86_400_000)) : null;
    signal = adSignal({ row, ctrDecay: ctrDecay(fatigue(data, f.model, ad.platform, ad.id)), ageDays, settings: data.settings });
  }

  return {
    level,
    key,
    platform,
    name: name ?? `Unknown ${LEVEL_LABELS[level].toLowerCase()} (${id ?? key})`,
    status,
    context,
    ad,
    row,
    signal,
    analysis: breakdown(data, f, level, key),
  };
}

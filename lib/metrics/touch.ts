/**
 * Map a credited touchpoint to an ad platform, campaign and ad.
 * Relies on the UTM convention: utm_campaign = platform campaign ID, utm_content = platform ad ID.
 */
import type { SourceSignals } from "../channel";
import { classifyChannel } from "../channel";
import type { Platform, Touch } from "./types";

const SOURCE_PLATFORMS: Record<string, Platform> = {
  facebook: "meta",
  fb: "meta",
  instagram: "meta",
  ig: "meta",
  meta: "meta",
  google: "google",
  youtube: "google",
  adwords: "google",
  tiktok: "tiktok",
  bing: "microsoft",
  microsoft: "microsoft",
};

const PAID_CHANNELS = new Set(["paid_search", "paid_social"]);

export function platformOf(s: SourceSignals): Platform | null {
  if (s.gclid) return "google";
  if (s.msclkid) return "microsoft";
  if (s.ttclid) return "tiktok";
  const source = s.utm_source?.trim().toLowerCase() ?? "";
  if (SOURCE_PLATFORMS[source]) return SOURCE_PLATFORMS[source];
  if (s.fbclid) return "meta";
  return null;
}

export type TouchSignals = SourceSignals & { utm_campaign?: string | null; utm_content?: string | null };

const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

/** Build the Touch for a credited event (or a direct result when there is none). */
export function toTouch(s: TouchSignals | null): Touch {
  if (!s) return { channel: "direct", platform: null, campaignId: null, adId: null };
  const channel = classifyChannel(s);
  const platform = platformOf(s);
  // Campaign/ad IDs only mean something for paid traffic from a known platform.
  const paid = platform !== null && PAID_CHANNELS.has(channel);
  return {
    channel,
    platform: paid ? platform : null,
    campaignId: paid ? clean(s.utm_campaign) : null,
    adId: paid ? clean(s.utm_content) : null,
  };
}

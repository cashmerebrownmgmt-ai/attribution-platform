/**
 * The one data shape every dashboard page is computed from. Live (Supabase) and Demo
 * (generated) sources both produce it. See docs/phase-3-spec.md.
 */
import type { Model } from "../attribution";
import type { Channel } from "../channel";

export type Platform = "meta" | "google" | "tiktok" | "microsoft";
export const AD_PLATFORMS: Platform[] = ["meta", "google", "tiktok"];

/** Where an order's credit landed under one attribution model. */
export type Touch = {
  channel: Channel;
  platform: Platform | null;
  campaignId: string | null;
  adId: string | null;
};

export type OrderFact = {
  id: string;
  name: string;
  createdAt: string; // ISO
  revenue: number;
  isNew: boolean;
  cancelled: boolean;
  stitchMethod: string;
  touches: Record<Model, Touch>;
  /** Channel of each storefront session before the order, oldest first (for journey paths). */
  path: Channel[];
  /** Days from first session in the window to the order. Null when not stitched. */
  daysToPurchase: number | null;
  /** Shopify customer ID or email hash; null when unknown (guest with no email). */
  customerKey: string | null;
  /** SHA-256 of the normalized email (never the email). Only needed for audience exports. */
  emailHash?: string | null;
  items: OrderItem[];
};

export type OrderItem = { key: string; title: string; quantity: number; revenue: number };

export type Campaign = {
  platform: Platform;
  id: string;
  name: string;
  status: string;
  objective: string | null;
  dailyBudget: number | null;
};

export type AdGroup = {
  platform: Platform;
  id: string;
  campaignId: string;
  name: string;
  status: string;
  dailyBudget: number | null;
};

export type Ad = {
  platform: Platform;
  id: string;
  adGroupId: string;
  campaignId: string;
  name: string;
  status: string;
  format: string | null;
  headline: string | null;
  body: string | null;
  thumbnailUrl: string | null;
  /** Playable video file for video ads, when the platform provides one. */
  videoUrl: string | null;
  /** Call-to-action button text, e.g. "Shop Now". */
  cta: string | null;
  landingUrl: string | null;
  launchedAt: string | null; // ISO date
};

export type Insight = {
  platform: Platform;
  adId: string;
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  platformConversions: number | null;
  platformRevenue: number | null;
};

export type Settings = {
  currency: string;
  targetRoas: number | null;
  targetCpa: number | null;
  breakevenRoas: number | null;
  lookbackDays: number;
  businessName: string | null;
};

export type HealthData = {
  /** Events per hour for the last 48 hours, oldest first. */
  eventsByHour: { hour: string; tracker: number; pixel: number }[];
  lastEventAt: string | null;
  webhooks24h: { total: number; failed: number };
  lastWebhookAt: string | null;
  /** Orders in the last 7 days by stitch method. */
  stitch7d: Record<string, number>;
  /** Pixel checkout_completed events vs orders, last 7 days. */
  pixelCheckouts7d: number;
  orders7d: number;
};

export type DashboardData = {
  mode: "live" | "demo";
  generatedAt: string;
  settings: Settings;
  orders: OrderFact[];
  campaigns: Campaign[];
  adGroups: AdGroup[];
  ads: Ad[];
  insights: Insight[];
  health: HealthData;
};

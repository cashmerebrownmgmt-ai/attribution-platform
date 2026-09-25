/**
 * Deterministic demo dataset for the dashboard: 3 ad platforms, campaigns, ads with distinct
 * performance stories (winners, a loser, a fatiguing creative), organic channels and tracking health.
 * Never written to the database. Same `endDay` + `seed` → identical data.
 */
import type { Model } from "../attribution";
import type { Channel } from "../channel";
import type { Ad, AdGroup, Campaign, DashboardData, HealthData, Insight, OrderFact, Platform, Touch } from "../metrics/types";

const DAY_MS = 86_400_000;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const between = (r: Rng, lo: number, hi: number) => lo + r() * (hi - lo);
const pick = <T,>(r: Rng, xs: T[]) => xs[Math.floor(r() * xs.length)];
function poisson(r: Rng, mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian(r)));
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}
function gaussian(r: Rng): number {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Deterministic 0..1 value from a string and a number (weekly budget changes per campaign). */
function hash01(text: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// ─── Catalog ──────────────────────────────────────────────────────────────────

type AdSpec = {
  name: string;
  format: "video" | "image" | "carousel" | "text" | "shopping";
  headline: string;
  body: string;
  /** Conversion-quality multiplier: >1 converts better than the platform baseline. */
  quality: number;
  /** Weekly CTR decay (0.06 = CTR falls 6% a week). */
  fatigue: number;
  /** Launch, in days before the end of the dataset. */
  launchedDaysAgo: number;
  /** Share of the ad group's budget. */
  weight: number;
  status?: string;
  /** Deliberately missing UTMs (shows up on the Health page). */
  missingUtms?: boolean;
};

type CampaignSpec = {
  name: string;
  objective: string;
  dailyBudget: number;
  newCustomerRate: number;
  status?: string;
  groups: { name: string; ads: AdSpec[] }[];
};

type PlatformSpec = {
  platform: Platform;
  cpm: number;
  ctr: number;
  cvr: number;
  /** How much the platform over-reports its own conversions vs first-party data. */
  overReport: number;
  campaigns: CampaignSpec[];
};

const CATALOG: PlatformSpec[] = [
  {
    platform: "meta",
    cpm: 14,
    ctr: 0.012,
    cvr: 0.038,
    overReport: 1.35,
    campaigns: [
      {
        name: "Prospecting – Broad (Advantage+)",
        objective: "sales",
        dailyBudget: 420,
        newCustomerRate: 0.78,
        groups: [
          {
            name: "Broad – US 18-45",
            ads: [
              { name: "UGC – ‘3 ways to style’ (Maya)", format: "video", headline: "One tee, three looks", body: "Our best-selling heavyweight tee, styled three ways in 20 seconds.", quality: 1.45, fatigue: 0.015, launchedDaysAgo: 120, weight: 0.4 },
              { name: "Static – Summer bundle 20% off", format: "image", headline: "Bundle & save 20%", body: "Any 3 tees for $75. Ends Sunday.", quality: 0.9, fatigue: 0.09, launchedDaysAgo: 62, weight: 0.3 },
              { name: "Carousel – Colorways", format: "carousel", headline: "12 colors. Pick yours.", body: "Garment-dyed, pre-shrunk, built to last.", quality: 1.0, fatigue: 0.035, launchedDaysAgo: 150, weight: 0.3 },
            ],
          },
        ],
      },
      {
        name: "Retargeting – 7-day visitors",
        objective: "sales",
        dailyBudget: 140,
        newCustomerRate: 0.22,
        groups: [
          {
            name: "Site visitors 7d",
            ads: [
              { name: "DPA – Viewed products", format: "carousel", headline: "Still thinking about it?", body: "Free shipping on your first order.", quality: 1.9, fatigue: 0.02, launchedDaysAgo: 170, weight: 0.65 },
              { name: "Testimonial – ‘Softest tee I own’", format: "video", headline: "4.9★ from 3,200 reviews", body: "Hear it from customers.", quality: 1.3, fatigue: 0.03, launchedDaysAgo: 95, weight: 0.35 },
            ],
          },
        ],
      },
      {
        name: "Creative testing – Hooks Q3",
        objective: "sales",
        dailyBudget: 90,
        newCustomerRate: 0.82,
        groups: [
          {
            name: "Hook tests",
            ads: [
              { name: "Hook A – ‘Stop buying cheap tees’", format: "video", headline: "Buy once, wear for years", body: "Why 300gsm cotton matters.", quality: 1.6, fatigue: 0.02, launchedDaysAgo: 21, weight: 0.34 },
              { name: "Hook B – Founder story", format: "video", headline: "Made in a family-run mill", body: "Meet the people behind your tee.", quality: 0.55, fatigue: 0.03, launchedDaysAgo: 24, weight: 0.33 },
              { name: "Hook C – Wash test", format: "video", headline: "50 washes later…", body: "Still no shrink, no fade.", quality: 1.1, fatigue: 0.02, launchedDaysAgo: 18, weight: 0.33, missingUtms: true },
            ],
          },
        ],
      },
    ],
  },
  {
    platform: "google",
    cpm: 22,
    ctr: 0.045,
    cvr: 0.026,
    overReport: 1.12,
    campaigns: [
      {
        name: "Search – Brand",
        objective: "search",
        dailyBudget: 60,
        newCustomerRate: 0.25,
        groups: [{ name: "Brand terms", ads: [{ name: "RSA – Brand", format: "text", headline: "Official Store – Free Shipping", body: "Heavyweight tees built to last.", quality: 2.4, fatigue: 0, launchedDaysAgo: 200, weight: 1 }] }],
      },
      {
        name: "Search – Non-brand",
        objective: "search",
        dailyBudget: 180,
        newCustomerRate: 0.72,
        groups: [
          { name: "Heavyweight t-shirt", ads: [{ name: "RSA – Heavyweight", format: "text", headline: "Heavyweight Cotton Tees", body: "300gsm. Pre-shrunk. 12 colors.", quality: 0.95, fatigue: 0, launchedDaysAgo: 200, weight: 0.6 }] },
          { name: "Plain t-shirts men", ads: [{ name: "RSA – Plain tees", format: "text", headline: "Premium Plain T-Shirts", body: "Better basics, fair prices.", quality: 0.6, fatigue: 0, launchedDaysAgo: 200, weight: 0.4 }] },
        ],
      },
      {
        name: "Performance Max – All products",
        objective: "sales",
        dailyBudget: 230,
        newCustomerRate: 0.55,
        groups: [{ name: "All products", ads: [{ name: "PMax – Asset group 1", format: "shopping", headline: "Shop heavyweight tees", body: "Free shipping over $50.", quality: 1.1, fatigue: 0.01, launchedDaysAgo: 200, weight: 1 }] }],
      },
    ],
  },
  {
    platform: "tiktok",
    cpm: 8,
    ctr: 0.009,
    cvr: 0.024,
    overReport: 1.6,
    campaigns: [
      {
        name: "Spark Ads – Creators",
        objective: "sales",
        dailyBudget: 160,
        newCustomerRate: 0.86,
        groups: [
          {
            name: "Creators – US",
            ads: [
              { name: "Spark – @jordanfits try-on", format: "video", headline: "The tee everyone’s asking about", body: "Link in bio.", quality: 1.25, fatigue: 0.05, launchedDaysAgo: 75, weight: 0.55 },
              { name: "Spark – @dailydrip haul", format: "video", headline: "Haul: basics that don’t suck", body: "Heavyweight, boxy fit.", quality: 0.75, fatigue: 0.08, launchedDaysAgo: 100, weight: 0.45 },
            ],
          },
        ],
      },
      {
        name: "TopView – Brand test",
        objective: "reach",
        dailyBudget: 75,
        newCustomerRate: 0.9,
        groups: [{ name: "Broad", ads: [{ name: "TopView – Brand film", format: "video", headline: "Built to last.", body: "", quality: 0.35, fatigue: 0.04, launchedDaysAgo: 35, weight: 1 }] }],
      },
    ],
  },
];

const ORGANIC_DAILY: { channel: Channel; orders: number; newRate: number }[] = [
  { channel: "email", orders: 7, newRate: 0.1 },
  { channel: "organic_search", orders: 6, newRate: 0.6 },
  { channel: "direct", orders: 8, newRate: 0.35 },
  { channel: "organic_social", orders: 2.5, newRate: 0.7 },
  { channel: "referral", orders: 1.2, newRate: 0.6 },
  { channel: "sms", orders: 1.5, newRate: 0.05 },
];

const PRODUCTS = [
  { key: "p-soul-reserve-2", title: "The Soul Reserve Vol. 2", price: 39 },
  { key: "p-808-essentials", title: "808 Essentials", price: 29 },
  { key: "p-drum-kit-heat", title: "Heat Drum Kit", price: 34 },
  { key: "p-melody-loops", title: "Late Night Melody Loops", price: 44 },
  { key: "p-producer-bundle", title: "Producer Bundle (5 kits)", price: 99 },
  { key: "p-vocal-chops", title: "Vocal Chops Vol. 1", price: 24 },
  { key: "p-1on1", title: "1-on-1 Mix Session", price: 150 },
  { key: "p-free-sample", title: "Starter Sample Pack", price: 9 },
];

/** A stable 64-hex stand-in for an email hash in demo data (not a real hash of anything). */
function demoHash(key: string): string {
  let h = 2166136261;
  let out = "";
  for (let round = 0; out.length < 64; round++) {
    for (const ch of `${key}:${round}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

const THUMB_HUES: Record<Platform, number> = { meta: 220, google: 140, tiktok: 330, microsoft: 200 };

// ─── Generator ────────────────────────────────────────────────────────────────

export type DemoOptions = { endDay: string; days?: number; seed?: number };

export function generateDemo({ endDay, days = 200, seed = 42 }: DemoOptions): DashboardData {
  const r = mulberry32(seed);
  const startDay = addDays(endDay, -(days - 1));
  const campaigns: Campaign[] = [];
  const adGroups: AdGroup[] = [];
  const ads: (Ad & { spec: AdSpec; campaign: CampaignSpec; platformSpec: PlatformSpec; groupBudgetShare: number })[] = [];

  let idSeq = 1000;
  for (const ps of CATALOG) {
    for (const cs of ps.campaigns) {
      const cid = `${ps.platform[0]}c${++idSeq}`;
      campaigns.push({ platform: ps.platform, id: cid, name: cs.name, status: cs.status ?? "active", objective: cs.objective, dailyBudget: cs.dailyBudget });
      for (const gs of cs.groups) {
        const gid = `${ps.platform[0]}g${++idSeq}`;
        adGroups.push({ platform: ps.platform, id: gid, campaignId: cid, name: gs.name, status: "active", dailyBudget: null });
        for (const as of gs.ads) {
          const aid = `${ps.platform[0]}a${++idSeq}`;
          const hue = (THUMB_HUES[ps.platform] + Math.round(r() * 60) - 30 + 360) % 360;
          ads.push({
            platform: ps.platform,
            id: aid,
            adGroupId: gid,
            campaignId: cid,
            name: as.name,
            status: as.status ?? "active",
            format: as.format,
            headline: as.headline,
            body: as.body,
            thumbnailUrl: `demo:${hue}`,
            videoUrl: null,
            cta: ps.platform === "tiktok" ? "Shop now" : as.format === "video" ? "Shop Now" : pick(r, ["Shop Now", "Learn More", "Shop Now"]),
            landingUrl: as.missingUtms
              ? "https://demo-store.example/products/heavyweight-tee"
              : `https://demo-store.example/products/heavyweight-tee?utm_source=${ps.platform}&utm_medium=${ps.platform === "google" ? "cpc" : "paid_social"}&utm_campaign=${cid}&utm_content=${aid}`,
            launchedAt: `${addDays(endDay, -as.launchedDaysAgo)}T00:00:00Z`,
            spec: as,
            campaign: cs,
            platformSpec: ps,
            groupBudgetShare: 1 / cs.groups.length,
          });
        }
      }
    }
  }

  const insights: Insight[] = [];
  const orders: OrderFact[] = [];
  let orderSeq = 1000;
  const customers: string[] = [];

  const newOrder = (day: string, revenue: number, isNew: boolean, touches: Record<Model, Touch>, path: Channel[], daysToPurchase: number | null, stitched: boolean): OrderFact => {
    const hour = Math.floor(between(r, 7, 23));
    const minute = Math.floor(r() * 60);
    let customerKey: string;
    if (isNew || customers.length === 0) {
      customerKey = `cust${customers.length}`;
      customers.push(customerKey);
    } else {
      // Returning buyers are spread across past customers, with a mild skew toward recent ones.
      customerKey = customers[Math.max(0, customers.length - 1 - Math.floor(Math.pow(r(), 0.6) * customers.length))];
    }
    const items: OrderFact["items"] = [];
    let total = 0;
    while (total < revenue * 0.75 || items.length === 0) {
      const p = pick(r, PRODUCTS);
      const existing = items.find((i) => i.key === p.key);
      if (existing) existing.quantity += 1;
      else items.push({ key: p.key, title: p.title, quantity: 1, revenue: 0 });
      total += p.price;
      if (items.length >= 4) break;
    }
    for (const i of items) i.revenue = Math.round(PRODUCTS.find((p) => p.key === i.key)!.price * i.quantity * 100) / 100;
    revenue = items.reduce((t, i) => t + i.revenue, 0);
    const n = ++orderSeq;
    return {
      id: `demo-${n}`,
      name: `#${n}`,
      createdAt: `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
      revenue: Math.round(revenue * 100) / 100,
      isNew,
      cancelled: r() < 0.012,
      stitchMethod: stitched ? pick(r, ["cart_attribute", "cart_attribute", "cart_attribute", "cart_attribute", "checkout_token", "customer_history"]) : "none",
      touches,
      path,
      daysToPurchase,
      customerKey,
      emailHash: demoHash(customerKey),
      items,
    };
  };

  const direct: Touch = { channel: "direct", platform: null, campaignId: null, adId: null };
  const organic = (channel: Channel): Touch => ({ channel, platform: null, campaignId: null, adId: null });
  const aov = () => Math.max(28, 72 + gaussian(r) * 22);

  for (let day = startDay; day <= endDay; day = addDays(day, 1)) {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const seasonal = 1 + 0.12 * Math.sin((Date.parse(day) / DAY_MS / 365) * 2 * Math.PI) + (dow === 0 || dow === 6 ? 0.08 : 0);
    const daysFromEnd = Math.round((Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);

    for (const ad of ads) {
      const s = ad.spec;
      if (daysFromEnd > s.launchedDaysAgo) continue;
      const ps = ad.platformSpec;
      const ageWeeks = (s.launchedDaysAgo - daysFromEnd) / 7;
      // Budget ramps up over the first few days of an ad's life.
      const ramp = Math.min(1, 0.35 + (s.launchedDaysAgo - daysFromEnd) * 0.15);
      // Budgets move week to week (as real buyers adjust them); returns diminish as spend rises.
      const budgetMult = 0.6 + 0.8 * hash01(ad.campaign.name, Math.floor(daysFromEnd / 7));
      const spend = ad.campaign.dailyBudget * ad.groupBudgetShare * s.weight * ramp * between(r, 0.85, 1.12) * seasonal * budgetMult;
      const cpm = ps.cpm * between(r, 0.88, 1.15) * (1 + ageWeeks * s.fatigue * 0.35);
      const impressions = Math.round((spend / cpm) * 1000);
      const ctr = ps.ctr * Math.pow(1 - s.fatigue, ageWeeks) * between(r, 0.9, 1.1) * (0.8 + 0.4 * s.quality ** 0.3);
      const clicks = Math.round(impressions * ctr);
      const conversions = poisson(r, clicks * ps.cvr * s.quality * Math.pow(budgetMult, -0.3));

      let revenue = 0;
      for (let k = 0; k < conversions; k++) {
        const value = aov();
        const isNew = r() < ad.campaign.newCustomerRate;
        const paidChannel: Channel = ps.platform === "google" ? "paid_search" : "paid_social";
        const adTouch: Touch = { channel: paidChannel, platform: ps.platform, campaignId: ad.campaignId, adId: ad.id };
        // Some paid orders started elsewhere, and some came back direct before buying.
        const assisted = r() < 0.28 ? pick(r, ads.filter((a) => a.platformSpec.platform !== "google" && daysFromEnd <= a.spec.launchedDaysAgo)) : null;
        const firstTouch: Touch = assisted
          ? { channel: "paid_social", platform: assisted.platform, campaignId: assisted.campaignId, adId: assisted.id }
          : adTouch;
        const cameBackDirect = r() < 0.22;
        const stitched = r() < 0.9;
        const touches: Record<Model, Touch> = stitched
          ? { first_touch: firstTouch, last_touch: cameBackDirect ? direct : adTouch, last_non_direct: adTouch }
          : { first_touch: direct, last_touch: direct, last_non_direct: direct };
        const path: Channel[] = stitched ? [firstTouch.channel, ...(assisted ? [paidChannel] : []), ...(cameBackDirect ? ["direct" as Channel] : [])] : [];
        const placed = newOrder(day, value, isNew, touches, path, stitched ? (assisted || cameBackDirect ? Math.floor(between(r, 1, 21)) : Math.floor(between(r, 0, 3))) : null, stitched);
        revenue += placed.revenue; // platforms report the real order value (then over-claim)
        orders.push(placed);
      }

      insights.push({
        platform: ps.platform,
        adId: ad.id,
        date: day,
        spend: Math.round(spend * 100) / 100,
        impressions,
        clicks,
        platformConversions: Math.round(conversions * ps.overReport * between(r, 0.9, 1.1) * 100) / 100,
        platformRevenue: Math.round(revenue * ps.overReport * between(r, 0.9, 1.1) * 100) / 100,
      });
    }

    for (const o of ORGANIC_DAILY) {
      const n = poisson(r, o.orders * seasonal);
      for (let k = 0; k < n; k++) {
        const t = organic(o.channel);
        const stitched = o.channel !== "direct" || r() < 0.7;
        const touches: Record<Model, Touch> = { first_touch: t, last_touch: t, last_non_direct: t };
        orders.push(newOrder(day, aov(), r() < o.newRate, touches, stitched ? [o.channel] : [], stitched ? Math.floor(between(r, 0, 10)) : null, stitched));
      }
    }
  }

  orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    mode: "demo",
    generatedAt: `${endDay}T12:00:00Z`,
    settings: { currency: "USD", targetRoas: 2.5, targetCpa: 30, breakevenRoas: 1.8, lookbackDays: 30, businessName: "Demo Heavyweight Co." },
    orders,
    campaigns,
    adGroups,
    ads: ads.map((a): Ad => ({
      platform: a.platform, id: a.id, adGroupId: a.adGroupId, campaignId: a.campaignId, name: a.name, status: a.status,
      format: a.format, headline: a.headline, body: a.body, thumbnailUrl: a.thumbnailUrl, videoUrl: null, cta: a.cta, landingUrl: a.landingUrl, launchedAt: a.launchedAt,
    })),
    insights,
    health: demoHealth(r, endDay, orders),
  };
}

function demoHealth(r: Rng, endDay: string, orders: OrderFact[]): HealthData {
  const end = Date.parse(`${endDay}T12:00:00Z`);
  const eventsByHour = Array.from({ length: 48 }, (_, i) => {
    const t = new Date(end - (47 - i) * 3_600_000);
    const hour = t.getUTCHours();
    const base = 40 + 110 * Math.max(0, Math.sin(((hour - 6) / 24) * 2 * Math.PI));
    return { hour: t.toISOString(), tracker: Math.round(base * between(r, 0.85, 1.15)), pixel: Math.round(base * 0.06 * between(r, 0.7, 1.3)) };
  });
  const weekAgo = new Date(end - 7 * DAY_MS).toISOString();
  const recent = orders.filter((o) => o.createdAt >= weekAgo);
  const stitch7d: Record<string, number> = {};
  for (const o of recent) stitch7d[o.stitchMethod] = (stitch7d[o.stitchMethod] ?? 0) + 1;
  return {
    eventsByHour,
    lastEventAt: new Date(end - 40_000).toISOString(),
    webhooks24h: { total: Math.round(recent.length / 7) * 3, failed: 0 },
    lastWebhookAt: new Date(end - 180_000).toISOString(),
    stitch7d,
    pixelCheckouts7d: Math.round(recent.length * 0.94),
    orders7d: recent.length,
  };
}

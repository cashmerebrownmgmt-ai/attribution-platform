/**
 * Tracking health checks: is data flowing, is it complete, can we trust it?
 * Pure; the Health page and (later) alerts use the same checks.
 */
import { addDays, dayOf } from "./compute";
import type { DashboardData } from "./types";

export type Level = "ok" | "warn" | "bad";
export type Check = { id: string; name: string; level: Level; detail: string; fix?: string };

const minutesSince = (iso: string | null, now: number) => (iso ? (now - Date.parse(iso)) / 60_000 : null);

function ago(min: number): string {
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

export function healthChecks(data: DashboardData, now = Date.parse(data.generatedAt)): Check[] {
  const h = data.health;
  const checks: Check[] = [];

  // 1. Storefront tracking script
  const evMin = minutesSince(h.lastEventAt, now);
  checks.push(
    evMin === null
      ? { id: "tracker", name: "Tracking script", level: "bad", detail: "No visits received yet.", fix: "Add the tracking script tag to your Shopify theme." }
      : evMin > 180
        ? { id: "tracker", name: "Tracking script", level: "bad", detail: `Last visit received ${ago(evMin)}.`, fix: "Check the script tag is still in your theme and ALLOWED_ORIGINS includes your store domain." }
        : evMin > 30
          ? { id: "tracker", name: "Tracking script", level: "warn", detail: `Last visit received ${ago(evMin)}. Quiet, or tracking may have stopped.` }
          : { id: "tracker", name: "Tracking script", level: "ok", detail: `Receiving visits · last ${ago(evMin)}.` },
  );

  // 2. Checkout pixel coverage
  if (h.orders7d > 0) {
    const coverage = h.pixelCheckouts7d / h.orders7d;
    checks.push(
      coverage >= 0.85
        ? { id: "pixel", name: "Checkout pixel", level: "ok", detail: `Saw ${Math.round(coverage * 100)}% of last week's checkouts.` }
        : coverage >= 0.5
          ? { id: "pixel", name: "Checkout pixel", level: "warn", detail: `Saw only ${Math.round(coverage * 100)}% of last week's checkouts.`, fix: "Some visitors decline analytics cookies; if this drops further, check the pixel is connected in Shopify → Customer events." }
          : { id: "pixel", name: "Checkout pixel", level: "bad", detail: `Saw ${Math.round(coverage * 100)}% of last week's checkouts.`, fix: "Check the custom pixel is connected in Shopify → Settings → Customer events." },
    );
  } else {
    checks.push({ id: "pixel", name: "Checkout pixel", level: "warn", detail: "No orders in the last 7 days to compare against." });
  }

  // 3. Match rate
  const total = Object.values(h.stitch7d).reduce((t, n) => t + n, 0);
  if (total > 0) {
    const rate = 1 - (h.stitch7d.none ?? 0) / total;
    checks.push(
      rate >= 0.8
        ? { id: "match", name: "Orders matched to visitors", level: "ok", detail: `${Math.round(rate * 100)}% of last week's orders have a known journey.` }
        : rate >= 0.6
          ? { id: "match", name: "Orders matched to visitors", level: "warn", detail: `${Math.round(rate * 100)}% matched. Typical healthy stores see 80%+.`, fix: "Check the tracking script loads on every page, including the cart." }
          : { id: "match", name: "Orders matched to visitors", level: "bad", detail: `Only ${Math.round(rate * 100)}% of orders matched.`, fix: "The cart attribute may not be reaching orders. Check the script runs on the cart page." },
    );
  }

  // 4. Shopify webhooks
  const whMin = minutesSince(h.lastWebhookAt, now);
  checks.push(
    h.webhooks24h.failed > 0
      ? { id: "webhooks", name: "Shopify order webhooks", level: "bad", detail: `${h.webhooks24h.failed} of ${h.webhooks24h.total} deliveries failed in the last 24 h.`, fix: "Open the order explorer to see the error; Shopify retries automatically." }
      : whMin === null
        ? { id: "webhooks", name: "Shopify order webhooks", level: "bad", detail: "No orders received from Shopify yet.", fix: "Create the webhook subscriptions in your Shopify app." }
        : { id: "webhooks", name: "Shopify order webhooks", level: "ok", detail: `${h.webhooks24h.total} deliveries in 24 h, none failed · last ${ago(whMin)}.` },
  );

  // 5. UTM tags on ads (spend-weighted)
  const since = addDays(dayOf(data.generatedAt), -6);
  const spendByAd = new Map<string, number>();
  for (const i of data.insights) if (i.date >= since) spendByAd.set(`${i.platform}:${i.adId}`, (spendByAd.get(`${i.platform}:${i.adId}`) ?? 0) + i.spend);
  const spend = [...spendByAd.values()].reduce((t, n) => t + n, 0);
  if (spend > 0) {
    const untagged = data.ads.filter((a) => (spendByAd.get(`${a.platform}:${a.id}`) ?? 0) > 0 && !(a.landingUrl ?? "").includes("utm_content="));
    const untaggedSpend = untagged.reduce((t, a) => t + (spendByAd.get(`${a.platform}:${a.id}`) ?? 0), 0);
    const share = untaggedSpend / spend;
    checks.push(
      untagged.length === 0
        ? { id: "utm", name: "Ad UTM tags", level: "ok", detail: "Every active ad carries campaign and ad IDs." }
        : {
            id: "utm",
            name: "Ad UTM tags",
            level: share > 0.1 ? "bad" : "warn",
            detail: `${untagged.length} active ad${untagged.length > 1 ? "s" : ""} (${Math.round(share * 100)}% of spend) missing utm_content: ${untagged.slice(0, 3).map((a) => a.name).join(", ")}${untagged.length > 3 ? "…" : ""}.`,
            fix: "Add the URL parameters from Settings → Ad accounts so sales are credited to the right ad.",
          },
    );
  }

  // 6. Ad platform data freshness
  const latest = data.insights.reduce<string | null>((m, i) => (m === null || i.date > m ? i.date : m), null);
  if (latest === null) {
    checks.push({ id: "sync", name: "Ad platform data", level: "warn", detail: "No ad accounts connected yet.", fix: "Connect Meta, Google and TikTok in Settings → Ad accounts." });
  } else {
    const staleDays = (Date.parse(dayOf(data.generatedAt)) - Date.parse(latest)) / 86_400_000;
    checks.push(
      staleDays <= 1
        ? { id: "sync", name: "Ad platform data", level: "ok", detail: `Spend is up to date (through ${latest}).` }
        : { id: "sync", name: "Ad platform data", level: staleDays > 3 ? "bad" : "warn", detail: `Latest spend is from ${latest}.`, fix: "Check the ad account connections in Settings." },
    );
  }

  return checks;
}

export function overallLevel(checks: Check[]): Level {
  return checks.some((c) => c.level === "bad") ? "bad" : checks.some((c) => c.level === "warn") ? "warn" : "ok";
}

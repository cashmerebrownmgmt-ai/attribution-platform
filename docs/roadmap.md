# Roadmap: Full Attribution & Ad Decision Platform

**Owner decisions (2026-09-24):** built for the owner's own store(s), not multi-client. Ad sources: Meta, Google Ads and TikTok. The AI **advises only** and never changes ads. Build in visible stages.

Each phase gets its own spec in `docs/` before building, following the same rules as Phase 1 (plan first, tests before moving on).

## Why this order

Every number the platform shows ("this ad returned 3.1× ROAS") needs two things joined together:

1. **Revenue per ad**, from first-party tracking stitched to Shopify orders (Phase 1).
2. **Cost per ad**, from the ad platforms (Phase 2).

The dashboards and the AI are only as good as that join, so the data foundation comes first.

---

## Phase 1: Tracking and order stitching *(in progress)*
Spec: `phase-1-spec.md`. Collect endpoint ✅, tracking script ✅, Shopify webhooks, stitching and attribution, backfill, debug page.

## Phase 2: Ad platform data
- **Connectors:** Meta Marketing API, Google Ads API and TikTok Marketing API, all read-only.
- **Data pulled:** accounts, campaigns, ad sets / ad groups, ads, creatives (thumbnail, video, copy, headline) and daily insights (spend, impressions, clicks, CTR, CPM, CPC, frequency, video views, platform-reported conversions and value).
- **Sync:** hourly for today, plus a nightly re-pull of the last 7 days (platforms restate numbers). Runs on Vercel Cron, with a sync log.
- **Joining ads to visits:** a required UTM convention on every ad, e.g. `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}`. Also matching by click ID (gclid, fbclid, ttclid). A UTM checker flags ads missing tags.
- **New tables:** `ad_accounts`, `campaigns`, `ad_groups`, `ads`, `creatives`, `ad_insights_daily`, `sync_runs`.

## Phase 3: App, login and dashboards
- **Login and admin:** Supabase Auth (email + magic link), team invites, roles (Owner / Admin / Viewer), an audit log and a settings area (stores, ad accounts, targets, business profile).
- **Overview:** revenue, ad spend, blended ROAS, MER, CPA, AOV, orders, new vs returning customers and new-customer ROAS, compared with the previous period, with animated trend charts.
- **Channels:** performance by channel and platform.
- **Campaigns → ad sets → ads:** a drill-down table with spend, attributed revenue, ROAS, CPA, CTR, CPM and frequency. Includes an attribution-model switcher and a lookback-window picker.
- **Creative gallery:** thumbnails ranked by performance, with fatigue curves (CTR and ROAS over the creative's age).
- **Customer journeys:** each order's touchpoint path (the Phase 1 debug page grows into this).
- **Cohorts and LTV:** repeat purchase and 30/60/90-day LTV by first-touch channel.
- **Flow diagrams:** a Sankey chart of channel paths to purchase.

## Phase 4: Pixel and data health
- **Live status:** tracker heartbeat (events in the last hour), pixel checkout events vs orders and webhook delivery and failures.
- **Quality metrics:** match rate (orders stitched to a visitor), share of ad spend with correct UTMs, and ad platform sync status.
- **Setup checks:** is the script on every page, is consent blocking tracking, is the cart attribute reaching orders.
- **Alerts:** email when tracking drops, webhooks fail or match rate falls.

## Phase 5: AI advisor (Claude, advise only)
- **Rule engine first, AI second:** clear, tested rules produce signals, and Claude explains them in plain language. Every suggestion shows the numbers behind it. Example rules:
  - **Scale:** ROAS above target for 7+ days, stable CPA, frequency < 2.5 → suggest a +15–20% budget increase.
  - **Pause:** spend > 2× target CPA with no purchases, or ROAS < 50% of break-even for 5+ days.
  - **Refresh creative:** CTR down 25%+ from its first-week level, frequency > 3, or CPM rising while CTR falls.
  - **Shift budget:** from the bottom to the top performers within a campaign.
- **Weekly brief:** what worked, what didn't, what to do this week.
- **Ask your data:** a chat that answers questions from your numbers ("Which TikTok ads drove new customers last month?").
- **Creative tips:** based on a business profile (products, audience, brand voice, margins) and on patterns in your winning creatives (hooks, formats, lengths, offers).
- **Guided onboarding:** a setup walkthrough for new team members.

## Phase 6: Reports
- PDF and CSV export of any dashboard view.
- A scheduled weekly or monthly email report with the AI summary.

---

## Additions the original brief didn't list
- **Profit, not just revenue.** Product costs (COGS), shipping, payment fees and ad spend give contribution margin and your **break-even ROAS**. The AI's "scale/pause" advice should use profit, not ROAS alone.
- **Sending conversions back to the ad platforms** (Meta Conversions API, Google Enhanced Conversions, TikTok Events API). Your first-party data improves the platforms' own targeting. This is often the biggest performance gain.
- **More attribution models.** Linear, time-decay and position-based, alongside first, last and last-non-direct touch, so you can compare views.
- **Post-purchase survey** ("How did you hear about us?") to capture channels that can't be tracked (influencers, podcasts, word of mouth).
- **Platform vs first-party comparison.** Show what Meta or Google claim next to what your own tracking sees.
- **Data retention, backups and privacy requests**, handled automatically.

## What the owner needs to start early
| Item | Why | Lead time |
|---|---|---|
| **Google Ads API developer token** | Required for Google data | Days to weeks for Google's approval. Apply first |
| **Meta developer app + System User token** (`ads_read`) | Meta data | Same day, if Business Manager is verified |
| **TikTok for Business developer app** | TikTok data | A few days for approval |
| **Anthropic API key** | AI advisor | Same day |
| **Vercel Pro** (probably) | Hourly cron jobs; Hobby allows only daily | Same day |

# Phase 3 Spec: Dashboard, Login and Settings

**Status:** Approved to build (owner: "keep building the full dashboard", 2026-09-24). See `roadmap.md`.

## Goal
A logged-in dashboard where the owner and team can see what their marketing earns: revenue, spend, ROAS, CPA and new customers, by channel, platform, campaign, ad and creative, over any date range and attribution model.

## Data modes
- **Live:** reads Supabase. Revenue and credit come from Phase 1. Spend comes from the ad tables below, which Phase 2 connectors fill. Until then, spend shows as 0 and the UI says "connect ad accounts".
- **Demo:** a deterministic, generated 90-day dataset (Meta, Google and TikTok, with campaigns, ads, creatives, orders and tracking health). It is never written to the database, and a "Demo data" badge is always visible. Toggled per user in the header.

Both modes produce the same `DashboardData` shape, and every page is computed from it by pure functions in `lib/metrics/`.

## Joining revenue to ads
An order's credited touchpoint (per the selected model) is mapped to:
- **platform:** from click ID (gclid/msclkid → google/microsoft, fbclid → meta, ttclid → tiktok), else `utm_source` (facebook/fb/instagram/ig/meta → meta, google → google, tiktok → tiktok).
- **campaign:** `utm_campaign` = platform campaign ID.
- **ad:** `utm_content` = platform ad ID.

This requires the UTM convention in `roadmap.md`. Ads missing it are flagged on the Health page (Phase 4).

## Metrics
| Metric | Definition |
|---|---|
| Revenue | Sum of `total_price` of non-cancelled orders in range (store currency) |
| Attributed revenue | Revenue credited to a channel/platform/campaign/ad under the selected model |
| Spend | Sum of `ad_insights_daily.spend` |
| ROAS | Attributed revenue ÷ spend |
| Blended ROAS / MER | Total revenue ÷ total spend |
| CPA | Spend ÷ attributed orders |
| New-customer orders | Orders where it's the customer's first order (by customer ID, else email hash) |
| nc-ROAS | Attributed new-customer revenue ÷ spend |
| AOV | Revenue ÷ orders |
| CTR / CPM / CPC / Frequency | From platform insights |
| Platform-reported ROAS | Platform conversions value ÷ spend, shown next to first-party ROAS |

Every KPI is compared with the previous period of equal length.

## Pages (`/dashboard/*`)
1. **Overview:** hero revenue figure, KPI tiles with deltas and sparklines, revenue & spend trend (two charts, never dual-axis), ROAS trend, channel mix and top ads.
2. **Channels:** a table and bars by channel and platform.
3. **Campaigns:** campaign → ad set → ad drill-down with sortable columns and first-party vs platform ROAS.
4. **Creatives:** a gallery ranked by ROAS, with a fatigue chart (CTR by creative age).
5. **Journeys:** a channel path Sankey, time-to-purchase, and a link to the order explorer (the Phase 1 debug pages).
6. **Health:** tracking status (Phase 4 fills this out).
7. **Settings:** team members and roles, targets (target ROAS, target CPA, break-even ROAS), business profile (used by the AI in Phase 5), and ad account connections (Phase 2).

Global filter row: date range (7/14/30/90 days, month to date, custom), attribution model and platform. Filters scope every chart on the page and are kept in the URL.

## Login and roles
- Supabase Auth with email + password and magic link.
- `members(user_id, email, role)` with roles owner / admin / viewer. The **first person to sign in becomes owner**; after that, only invited emails can join. Owners and admins invite; only owners change roles.
- `proxy.ts` refreshes the session and redirects signed-out users to `/login`. The `/debug` pages move behind the same login (admin+), and `DEBUG_PASSWORD` is retired.
- All dashboard queries run on the server with the service role, after checking membership.

## Charts
Hand-built SVG React components (no chart library), following the data-viz rules: validated categorical palette in fixed order per entity, selected dark mode, 2px lines, ≤24px bars with 4px rounded ends, hover tooltips with crosshair, a legend for ≥2 series, a table view for every chart and no dual axes. Animations are short transitions on load and on filter change, disabled under `prefers-reduced-motion`.

## Tests
Pure metrics (every definition above), platform/campaign/ad mapping, the demo generator (deterministic, internally consistent), role checks and chart scale helpers.

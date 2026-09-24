import Link from "next/link";
import { filterQuery, PLATFORM_LABELS } from "@/lib/dashboard/filters";
import { roas } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { performance, type Level } from "@/lib/metrics/compute";
import s from "../dashboard.module.css";
import { BarList } from "../_components/charts/BarList";
import { DataTable } from "../_components/DataTable";
import { Card, Filters, PageHead, PLATFORM_COLORS } from "../_components/ui";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CampaignsPage({ searchParams }: PageProps<"/dashboard/campaigns">) {
  const { mode, data, filters: f, params } = await loadPage(searchParams);
  const cur = data.settings.currency;
  const t = data.settings;

  // Drill-down: ?campaign=platform:id → ad sets; ?group=platform:id → ads; ?level=ad → every ad.
  const campaignKey = one(params.campaign);
  const groupKey = one(params.group);
  const campaign = campaignKey ? data.campaigns.find((c) => `${c.platform}:${c.id}` === campaignKey) : undefined;
  const group = groupKey ? data.adGroups.find((g) => `${g.platform}:${g.id}` === groupKey) : undefined;
  const groupCampaign = group ? data.campaigns.find((c) => c.platform === group.platform && c.id === group.campaignId) : undefined;

  let level: Level = one(params.level) === "ad" ? "ad" : "campaign";
  let parent: { campaignId?: string; adGroupId?: string } | undefined;
  if (group) {
    level = "ad";
    parent = { adGroupId: group.id };
  } else if (campaign) {
    level = "adGroup";
    parent = { campaignId: campaign.id };
  }
  const rows = performance(data, { ...f, platform: group?.platform ?? campaign?.platform ?? f.platform }, level, parent);

  const levelName = level === "campaign" ? "Campaign" : level === "adGroup" ? "Ad set" : "Ad";
  const hrefFor = (key: string) =>
    level === "campaign" ? `/dashboard/campaigns${filterQuery(f, { campaign: key, level: null })}` : level === "adGroup" ? `/dashboard/campaigns${filterQuery(f, { group: key })}` : `/dashboard/creatives${filterQuery(f, { ad: key })}`;

  const crumbs = [
    { label: "All campaigns", href: `/dashboard/campaigns${filterQuery(f)}` },
    ...(campaign || groupCampaign
      ? [{ label: (campaign ?? groupCampaign)!.name, href: `/dashboard/campaigns${filterQuery(f, { campaign: `${(campaign ?? groupCampaign)!.platform}:${(campaign ?? groupCampaign)!.id}` })}` }]
      : []),
    ...(group ? [{ label: group.name, href: null }] : []),
  ];

  return (
    <>
      <PageHead title="Campaigns" subtitle="Drill from campaigns to ad sets to individual ads" mode={mode} />
      <Filters f={f} showPlatform={!campaign && !group} />

      <nav aria-label="Breadcrumb" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 14, fontSize: 13 }}>
        {crumbs.map((c, i) => (
          <span key={c.label} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {i > 0 && <span className={s.muted}>/</span>}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} style={{ color: "var(--accent)", textDecoration: "none" }}>
                {c.label}
              </Link>
            ) : (
              <strong>{c.label}</strong>
            )}
          </span>
        ))}
        {!campaign && !group && (
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Link className={s.button} href={`/dashboard/campaigns${filterQuery(f, { level: null })}`} aria-current={level === "campaign" ? "page" : undefined} style={level === "campaign" ? { background: "var(--accent-wash)" } : undefined}>
              Campaigns
            </Link>
            <Link className={s.button} href={`/dashboard/campaigns${filterQuery(f, { level: "ad" })}`} aria-current={level === "ad" ? "page" : undefined} style={level === "ad" ? { background: "var(--accent-wash)" } : undefined}>
              All ads
            </Link>
          </span>
        )}
      </nav>

      <div className={s.stack}>
        <Card title={`ROAS by ${levelName.toLowerCase()}`} sub={`Top 12 by spend${t.targetRoas ? ` · dashed line = target ${roas(t.targetRoas)}` : ""}`}>
          {rows.length === 0 ? (
            <div className={s.empty}>No spend or attributed revenue in this range.</div>
          ) : (
            <BarList
              label={`ROAS by ${levelName}`}
              kind="roas"
              items={rows.slice(0, 12).map((r) => ({
                key: r.key,
                label: r.name,
                value: r.roas,
                color: PLATFORM_COLORS[r.platform],
                note: `${PLATFORM_LABELS[r.platform]} · spend ${Math.round(r.spend).toLocaleString()}`,
              }))}
              target={t.targetRoas ? { value: t.targetRoas, label: `target ROAS ${roas(t.targetRoas)}` } : undefined}
            />
          )}
        </Card>
        <Card title={`${levelName}s`} sub="Click a row to drill in. Green/red compare against your targets.">
          <DataTable
            nameLabel={levelName}
            currency={cur}
            defaultSort="spend"
            columns={[
              { key: "spend", label: "Spend", kind: "money" },
              { key: "impressions", label: "Impr." },
              { key: "ctr", label: "CTR", kind: "pct" },
              { key: "cpc", label: "CPC", kind: "money" },
              { key: "orders", label: "Orders" },
              { key: "revenue", label: "Revenue", kind: "money" },
              { key: "roas", label: "ROAS", kind: "roas", target: t.targetRoas ? { value: t.targetRoas, better: "gte" } : undefined },
              { key: "platformRoas", label: "Platform ROAS", kind: "roas" },
              { key: "cpa", label: "CPA", kind: "money", target: t.targetCpa ? { value: t.targetCpa, better: "lte" } : undefined },
              { key: "newCustomers", label: "New cust." },
            ]}
            rows={rows.map((r) => ({
              id: r.key,
              name: r.name,
              href: hrefFor(r.key),
              color: PLATFORM_COLORS[r.platform],
              badge: r.status !== "active" ? r.status : undefined,
              values: { spend: r.spend, impressions: r.impressions, ctr: r.ctr, cpc: r.cpc, orders: r.orders, revenue: r.revenue, roas: r.roas, platformRoas: r.platformRoas, cpa: r.cpa, newCustomers: r.newCustomers },
            }))}
          />
        </Card>
      </div>
    </>
  );
}

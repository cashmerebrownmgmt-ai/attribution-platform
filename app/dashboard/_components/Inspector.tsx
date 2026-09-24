import Link from "next/link";
import { cache } from "react";
import { entityInfo as computeEntity, LEVEL_LABELS } from "@/lib/dashboard/entity";
import { filterQuery, type ParsedFilters } from "@/lib/dashboard/filters";
import { money, roas } from "@/lib/dashboard/format";
import { inspectHref, parseInspect } from "@/lib/dashboard/inspect";
import { performance, type Level } from "@/lib/metrics/compute";
import type { DashboardData } from "@/lib/metrics/types";
import s from "../dashboard.module.css";
import { BreakdownDrawer, QuickPreview } from "./Breakdown";
import { PLATFORM_COLORS } from "./ui";

type Params = Record<string, string | string[] | undefined>;

// Same entity shown in several places on a page (table + bar list) is analysed once per request.
const entityInfo = cache(computeEntity);

/** Server-rendered hover card for any entity. */
export function Preview({ data, f, level, entityKey }: { data: DashboardData; f: ParsedFilters; level: Level; entityKey: string }) {
  return <QuickPreview e={entityInfo(data, f, level, entityKey)} currency={data.settings.currency} brand={data.settings.businessName ?? "Your brand"} />;
}

const CHILD: Partial<Record<Level, Level>> = { platform: "campaign", campaign: "adGroup", adGroup: "ad" };

/**
 * The breakdown drawer for `?inspect=…`, on whatever page it's opened from. `keep` holds page
 * params (drill-down, open creative) that should survive opening/closing it.
 */
export function Inspector({ data, f, params, path, keep = {} }: { data: DashboardData; f: ParsedFilters; params: Params; path: string; keep?: Record<string, string | null> }) {
  const target = parseInspect(params.inspect);
  if (!target) return null;
  const e = entityInfo(data, f, target.level, target.key);
  const closeHref = `${path}${filterQuery(f, { ...keep, inspect: null })}`;
  const [platform, id] = target.key.split(":");

  const childLevel = CHILD[target.level];
  const children = childLevel
    ? performance(data, { ...f, platform: "all" }, childLevel, target.level === "platform" ? undefined : target.level === "campaign" ? { campaignId: id } : { adGroupId: id })
        .filter((r) => r.platform === platform)
        .slice(0, 12)
    : [];

  const actions =
    target.level === "ad" ? (
      <Link className={s.button} href={`/dashboard/creatives${filterQuery(f, { ad: target.key })}`}>
        Open creative
      </Link>
    ) : target.level === "campaign" ? (
      <Link className={s.button} href={`/dashboard/campaigns${filterQuery(f, { campaign: target.key })}`}>
        Ad sets ›
      </Link>
    ) : target.level === "adGroup" ? (
      <Link className={s.button} href={`/dashboard/campaigns${filterQuery(f, { group: target.key })}`}>
        Ads ›
      </Link>
    ) : undefined;

  return (
    <BreakdownDrawer e={e} currency={data.settings.currency} brand={data.settings.businessName ?? "Your brand"} closeHref={closeHref} actions={actions} targets={data.settings}>
      {childLevel && children.length > 0 && (
        <section>
          <h3 className={s.cardTitle}>{LEVEL_LABELS[childLevel]}s inside</h3>
          <div className={s.statusList}>
            {children.map((c) => (
              <Link key={c.key} href={inspectHref(path, f, childLevel, c.key, keep)} scroll={false} className={s.statusItem} style={{ textDecoration: "none", color: "inherit", gridTemplateColumns: "10px 1fr auto" }}>
                <span className={s.swatch} style={{ background: PLATFORM_COLORS[c.platform], marginTop: 4 }} />
                <span className={s.statusName} style={{ fontWeight: 500 }}>{c.name}</span>
                <span className={s.statusDetail} style={{ whiteSpace: "nowrap" }}>
                  {roas(c.roas)} · {money(c.spend, data.settings.currency, { compact: true })}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </BreakdownDrawer>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { filterQuery, PLATFORM_LABELS } from "@/lib/dashboard/filters";
import { money, num, pct, roas, signedPct } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { ctrDecay, dayOf, fatigue, performance, type PerfRow } from "@/lib/metrics/compute";
import { adSignal, VERDICT_LABELS, type Signal, type Verdict } from "@/lib/metrics/signals";
import type { Ad } from "@/lib/metrics/types";
import s from "../dashboard.module.css";
import { MetaPreview } from "../_components/MetaPreview";
import { isPreviewFormat, PREVIEW_FORMATS, type PreviewFormat } from "@/lib/meta";
import { ScrollLock } from "../_components/ScrollLock";
import { AdPreview } from "../_components/AdPreview";
import { LineChart } from "../_components/charts/LineChart";
import { LightboxKeys } from "../_components/LightboxKeys";
import { FindingList } from "../_components/Breakdown";
import { Inspector } from "../_components/Inspector";
import { entityInfo } from "@/lib/dashboard/entity";
import { inspectHref } from "@/lib/dashboard/inspect";
import { Card, Filters, PageHead, PLATFORM_COLORS } from "../_components/ui";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const VERDICTS: Verdict[] = ["scale", "keep", "watch", "refresh", "pause", "learning"];
const VERDICT_STYLE: Record<Verdict, { color: string; icon: string }> = {
  scale: { color: "var(--good-text)", icon: "▲" },
  keep: { color: "var(--good-text)", icon: "✓" },
  watch: { color: "var(--warn-text)", icon: "◆" },
  refresh: { color: "var(--warn-text)", icon: "↻" },
  pause: { color: "var(--bad-text)", icon: "■" },
  learning: { color: "var(--muted)", icon: "…" },
};

function VerdictFlag({ signal }: { signal: Signal }) {
  const st = VERDICT_STYLE[signal.verdict];
  return (
    <span className={s.flag} style={{ color: st.color }} title={signal.reasons.join(" · ")}>
      <span aria-hidden="true">{st.icon}</span> {VERDICT_LABELS[signal.verdict]}
    </span>
  );
}

type Item = { row: PerfRow; ad: Ad; decay: number | null; signal: Signal };

export default async function CreativesPage({ searchParams }: PageProps<"/dashboard/creatives">) {
  const { mode, data, filters: f, params } = await loadPage(searchParams);
  const cur = data.settings.currency;
  const brand = data.settings.businessName ?? "Your brand";
  const adIndex = new Map(data.ads.map((a) => [`${a.platform}:${a.id}`, a]));
  const endMs = Date.parse(`${f.range.to}T23:59:59Z`);

  const all: Item[] = performance(data, f, "ad")
    .map((row) => {
      const ad = adIndex.get(row.key);
      if (!ad) return null;
      const decay = ctrDecay(fatigue(data, f.model, ad.platform, ad.id));
      const ageDays = ad.launchedAt ? Math.max(0, Math.floor((endMs - Date.parse(ad.launchedAt)) / 86_400_000)) : null;
      return { row, ad, decay, signal: adSignal({ row, ctrDecay: decay, ageDays, settings: data.settings }) };
    })
    .filter((x): x is Item => x !== null)
    .sort((a, b) => (b.row.roas ?? -1) - (a.row.roas ?? -1));

  const verdictFilter = VERDICTS.find((v) => v === one(params.verdict)) ?? null;
  const items = verdictFilter ? all.filter((i) => i.signal.verdict === verdictFilter) : all;
  const counts = all.reduce<Partial<Record<Verdict, number>>>((m, i) => ({ ...m, [i.signal.verdict]: (m[i.signal.verdict] ?? 0) + 1 }), {});

  const placement = isPreviewFormat(one(params.pf)) ? (one(params.pf) as PreviewFormat) : "MOBILE_FEED_STANDARD";
  const base = { verdict: verdictFilter, pf: placement === "MOBILE_FEED_STANDARD" ? null : placement };
  const hrefFor = (key: string | null) => `/dashboard/creatives${filterQuery(f, { ...base, ad: key })}`;
  const selIdx = items.findIndex((i) => i.row.key === one(params.ad));
  const selected = selIdx >= 0 ? items[selIdx] : null;
  const curve = selected ? fatigue(data, f.model, selected.ad.platform, selected.ad.id) : [];
  const analysis = selected ? entityInfo(data, f, "ad", selected.row.key).analysis : null;

  return (
    <>
      <PageHead title="Creatives" subtitle="Every ad as your customers see it, ranked by return" mode={mode} />
      <Filters f={f} />

      <div className={s.chips} role="group" aria-label="Filter by verdict">
        <Link href={`/dashboard/creatives${filterQuery(f)}`} className={`${s.chip} ${!verdictFilter ? s.chipOn : ""}`} scroll={false}>
          All <span className={s.muted}>{all.length}</span>
        </Link>
        {VERDICTS.map((v) =>
          counts[v] ? (
            <Link key={v} href={`/dashboard/creatives${filterQuery(f, { verdict: v })}`} className={`${s.chip} ${verdictFilter === v ? s.chipOn : ""}`} scroll={false}>
              <span style={{ color: VERDICT_STYLE[v].color }} aria-hidden="true">{VERDICT_STYLE[v].icon}</span> {VERDICT_LABELS[v]}{" "}
              <span className={s.muted}>{counts[v]}</span>
            </Link>
          ) : null,
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <div className={s.empty}>No ads with spend in this range.</div>
        </Card>
      ) : (
        <div className={s.creativeGrid}>
          {items.map(({ row, ad, signal }) => (
            <Link key={row.key} href={hrefFor(row.key)} className={s.creative} scroll={false} aria-label={`Open ${ad.name}`}>
              <div className={s.creativeFrame}>
                <AdPreview ad={ad} brand={brand} />
              </div>
              <div className={s.creativeMeta}>
                <div className={s.creativeName}>
                  <span className={s.swatch} style={{ background: PLATFORM_COLORS[ad.platform] }} />
                  <span>{ad.name}</span>
                </div>
                <VerdictFlag signal={signal} />
                <div className={s.creativeStats}>
                  <div><b>{roas(row.roas)}</b><span>ROAS</span></div>
                  <div><b>{money(row.spend, cur, { compact: true })}</b><span>Spend</span></div>
                  <div><b>{pct(row.ctr, 2)}</b><span>CTR</span></div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {selected && (
        <div className={s.lightbox} role="dialog" aria-modal="true" aria-label={selected.ad.name}>
          <LightboxKeys
            close={hrefFor(null)}
            prev={selIdx > 0 ? hrefFor(items[selIdx - 1].row.key) : null}
            next={selIdx < items.length - 1 ? hrefFor(items[selIdx + 1].row.key) : null}
          />
          <ScrollLock />
          <Link href={hrefFor(null)} className={s.lightboxBackdrop} scroll={false} aria-label="Close" tabIndex={-1} />
          <div className={s.lightboxPanel}>
            <div className={s.lightboxBar}>
              <span className={s.muted}>
                {selIdx + 1} of {items.length}
              </span>
              <span className={s.barButtons}>
                {selIdx > 0 && (
                  <Link className={s.button} href={hrefFor(items[selIdx - 1].row.key)} scroll={false} aria-label="Previous ad">
                    ←<span className={s.navText}> Previous</span>
                  </Link>
                )}
                {selIdx < items.length - 1 && (
                  <Link className={s.button} href={hrefFor(items[selIdx + 1].row.key)} scroll={false} aria-label="Next ad">
                    <span className={s.navText}>Next </span>→
                  </Link>
                )}
                <Link className={`${s.button} ${s.closeButton}`} href={hrefFor(null)} scroll={false} autoFocus aria-label="Close">
                  Close ✕
                </Link>
              </span>
            </div>
            <div className={s.lightboxBody}>
              <div className={s.lightboxMedia}>
                {mode === "live" && selected.ad.platform === "meta" ? (
                  <>
                    <div className={s.chips} role="tablist" aria-label="Placement" style={{ marginBottom: 10 }}>
                      {(Object.keys(PREVIEW_FORMATS) as PreviewFormat[]).map((fmt) => (
                        <Link
                          key={fmt}
                          href={`/dashboard/creatives${filterQuery(f, { ...base, pf: fmt === "MOBILE_FEED_STANDARD" ? null : fmt, ad: selected.row.key })}`}
                          className={`${s.chip} ${fmt === placement ? s.chipOn : ""}`}
                          scroll={false}
                          replace
                          role="tab"
                          aria-selected={fmt === placement}
                        >
                          {PREVIEW_FORMATS[fmt]}
                        </Link>
                      ))}
                    </div>
                    <Suspense fallback={<div className={s.empty}>Loading Meta&apos;s preview…</div>}>
                      <MetaPreview key={`${selected.ad.id}-${placement}`} adId={selected.ad.id} format={placement} fallback={<AdPreview ad={selected.ad} brand={brand} size="large" />} />
                    </Suspense>
                  </>
                ) : (
                  <AdPreview ad={selected.ad} brand={brand} size="large" />
                )}
              </div>
              <div className={s.lightboxInfo}>
                <div className={s.creativeName} style={{ fontSize: 15 }}>
                  <span className={s.swatch} style={{ background: PLATFORM_COLORS[selected.ad.platform] }} />
                  <span>{selected.ad.name}</span>
                </div>
                <div className={s.cardSub}>
                  {PLATFORM_LABELS[selected.ad.platform]} · {selected.ad.format ?? "ad"} · launched {selected.ad.launchedAt ? dayOf(selected.ad.launchedAt) : "—"}
                </div>
                <div style={{ marginTop: 12 }}>
                  <VerdictFlag signal={selected.signal} />
                  <div style={{ fontWeight: 650, margin: "8px 0 4px" }}>{selected.signal.headline}</div>
                  <ul className={s.reasons}>
                    {selected.signal.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                {analysis && (
                  <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                    <FindingList title="What's helping" items={analysis.findings.filter((x) => x.effect === "helping").slice(0, 4)} empty="Nothing is clearly helping yet." />
                    <FindingList title="What's hurting" items={analysis.findings.filter((x) => x.effect === "hurting").slice(0, 4)} empty="Nothing is clearly hurting." />
                    <Link className={`${s.button} ${s.buttonPrimary}`} style={{ justifySelf: "start" }} href={inspectHref("/dashboard/creatives", f, "ad", selected.row.key, base)} scroll={false}>
                      Full breakdown ›
                    </Link>
                  </div>
                )}
                <div className={s.statGrid}>
                  <div><b>{roas(selected.row.roas)}</b><span>ROAS</span></div>
                  <div><b>{roas(selected.row.platformRoas)}</b><span>Platform ROAS</span></div>
                  <div><b>{money(selected.row.spend, cur)}</b><span>Spend</span></div>
                  <div><b>{money(selected.row.revenue, cur)}</b><span>Revenue</span></div>
                  <div><b>{num(selected.row.orders)}</b><span>Orders</span></div>
                  <div><b>{money(selected.row.cpa, cur)}</b><span>CPA</span></div>
                  <div><b>{pct(selected.row.ctr, 2)}</b><span>CTR</span></div>
                  <div><b>{money(selected.row.cpm, cur, { cents: true })}</b><span>CPM</span></div>
                  <div><b>{signedPct(selected.decay)}</b><span>CTR since launch</span></div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <div className={s.cardTitle}>Fatigue curve</div>
                  <div className={s.cardSub} style={{ marginBottom: 6 }}>Click-through rate by week since launch</div>
                  {curve.length < 2 ? (
                    <div className={s.empty}>Not enough history yet.</div>
                  ) : (
                    <LineChart label="CTR by week since launch" dates={curve.map((c) => `Week ${c.week + 1}`)} xFormat="raw" kind="pct" height={160} series={[{ name: "CTR", color: PLATFORM_COLORS[selected.ad.platform], values: curve.map((c) => c.ctr) }]} />
                  )}
                </div>
                {selected.ad.landingUrl && (
                  <p className={s.cardSub} style={{ marginTop: 10, wordBreak: "break-all" }}>
                    Landing page: {selected.ad.landingUrl}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <Inspector data={data} f={f} params={params} path="/dashboard/creatives" keep={base} />
    </>
  );
}

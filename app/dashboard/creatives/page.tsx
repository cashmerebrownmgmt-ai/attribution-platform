import Link from "next/link";
import { filterQuery, PLATFORM_LABELS } from "@/lib/dashboard/filters";
import { money, pct, roas, signedPct } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { ctrDecay, fatigue, performance, type PerfRow } from "@/lib/metrics/compute";
import { adSignal, VERDICT_LABELS, type Signal, type Verdict } from "@/lib/metrics/signals";
import type { Ad } from "@/lib/metrics/types";
import s from "../dashboard.module.css";
import { LineChart } from "../_components/charts/LineChart";
import { Card, Filters, PageHead, PLATFORM_COLORS } from "../_components/ui";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const VERDICT_STYLE: Record<Verdict, { color: string; icon: string }> = {
  scale: { color: "var(--good-text)", icon: "▲" },
  keep: { color: "var(--good-text)", icon: "✓" },
  watch: { color: "var(--warn-text)", icon: "◆" },
  refresh: { color: "var(--warn-text)", icon: "↻" },
  pause: { color: "var(--bad-text)", icon: "■" },
  learning: { color: "var(--muted)", icon: "…" },
};

function Thumb({ ad }: { ad: Ad }) {
  const url = ad.thumbnailUrl;
  const hue = url?.startsWith("demo:") ? Number(url.slice(5)) : null;
  const style =
    hue !== null
      ? { background: `linear-gradient(160deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 22%))` }
      : url
        ? { backgroundImage: `url(${JSON.stringify(url)})`, backgroundSize: "cover", backgroundPosition: "center" }
        : { background: "var(--surface-2)" };
  return (
    <div className={s.thumb} style={style}>
      <span className={s.thumbFormat}>{ad.format ?? "ad"}</span>
      <span className={s.thumbHeadline}>{ad.headline ?? ad.name}</span>
    </div>
  );
}

function VerdictFlag({ signal }: { signal: Signal }) {
  const st = VERDICT_STYLE[signal.verdict];
  return (
    <span className={s.flag} style={{ color: st.color }} title={signal.reasons.join(" · ")}>
      <span aria-hidden="true">{st.icon}</span> {VERDICT_LABELS[signal.verdict]}
    </span>
  );
}

export default async function CreativesPage({ searchParams }: PageProps<"/dashboard/creatives">) {
  const { mode, data, filters: f, params } = await loadPage(searchParams);
  const cur = data.settings.currency;
  const rows = performance(data, f, "ad");
  const adIndex = new Map(data.ads.map((a) => [`${a.platform}:${a.id}`, a]));
  const endMs = Date.parse(`${f.range.to}T23:59:59Z`);

  const items = rows
    .map((row) => {
      const ad = adIndex.get(row.key);
      if (!ad) return null;
      const decay = ctrDecay(fatigue(data, f.model, ad.platform, ad.id));
      const ageDays = ad.launchedAt ? Math.max(0, Math.floor((endMs - Date.parse(ad.launchedAt)) / 86_400_000)) : null;
      return { row, ad, decay, signal: adSignal({ row, ctrDecay: decay, ageDays, settings: data.settings }) };
    })
    .filter((x): x is { row: PerfRow; ad: Ad; decay: number | null; signal: Signal } => x !== null)
    .sort((a, b) => (b.row.roas ?? -1) - (a.row.roas ?? -1));

  const selectedKey = one(params.ad);
  const selected = items.find((i) => i.row.key === selectedKey) ?? null;
  const curve = selected ? fatigue(data, f.model, selected.ad.platform, selected.ad.id) : [];
  const counts = items.reduce<Partial<Record<Verdict, number>>>((m, i) => ({ ...m, [i.signal.verdict]: (m[i.signal.verdict] ?? 0) + 1 }), {});

  return (
    <>
      <PageHead title="Creatives" subtitle="Which ads are working, which are tired, and which to cut" mode={mode} />
      <Filters f={f} />

      {items.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {(["scale", "keep", "watch", "refresh", "pause", "learning"] as Verdict[]).map((v) =>
            counts[v] ? (
              <span key={v} className={s.flag} style={{ color: VERDICT_STYLE[v].color, padding: "4px 10px", fontSize: 12 }}>
                <span aria-hidden="true">{VERDICT_STYLE[v].icon}</span> {counts[v]} {VERDICT_LABELS[v].toLowerCase()}
              </span>
            ) : null,
          )}
        </div>
      )}

      {selected && (
        <div className={s.grid2}>
          <Card title={selected.ad.name} sub={`${PLATFORM_LABELS[selected.ad.platform]} · launched ${selected.ad.launchedAt?.slice(0, 10) ?? "—"}`} action={<Link className={s.button} href={`/dashboard/creatives${filterQuery(f)}`}>Close</Link>}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 180px) 1fr", gap: 16 }}>
              <Thumb ad={selected.ad} />
              <div>
                <VerdictFlag signal={selected.signal} />
                <h3 style={{ margin: "10px 0 6px", fontSize: 16 }}>{selected.signal.headline}</h3>
                <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)" }}>
                  {selected.signal.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className={s.creativeStats} style={{ marginTop: 14 }}>
                  <div><b>{roas(selected.row.roas)}</b><span>ROAS</span></div>
                  <div><b>{money(selected.row.spend, cur, { compact: true })}</b><span>Spend</span></div>
                  <div><b>{pct(selected.row.ctr, 2)}</b><span>CTR</span></div>
                  <div><b>{money(selected.row.revenue, cur, { compact: true })}</b><span>Revenue</span></div>
                  <div><b>{money(selected.row.cpa, cur)}</b><span>CPA</span></div>
                  <div><b>{signedPct(selected.decay)}</b><span>CTR change</span></div>
                </div>
              </div>
            </div>
            {selected.ad.body && <p className={s.cardSub} style={{ fontSize: 13, marginTop: 12 }}>Copy: “{selected.ad.body}”</p>}
          </Card>
          <Card title="Fatigue curve" sub="Click-through rate by week since launch (all time)">
            {curve.length < 2 ? (
              <div className={s.empty}>Not enough history yet.</div>
            ) : (
              <LineChart label="CTR by week since launch" dates={curve.map((c) => `Week ${c.week + 1}`)} xFormat="raw" kind="pct" series={[{ name: "CTR", color: PLATFORM_COLORS[selected.ad.platform], values: curve.map((c) => c.ctr) }]} height={220} />
            )}
          </Card>
        </div>
      )}

      <Card title="All creatives" sub="Ranked by ROAS for the selected range. Click one for details.">
        {items.length === 0 ? (
          <div className={s.empty}>No ads with spend in this range.</div>
        ) : (
          <div className={s.creativeGrid}>
            {items.map(({ row, ad, signal }) => (
              <Link key={row.key} href={`/dashboard/creatives${filterQuery(f, { ad: row.key })}`} className={s.creative} scroll={false} aria-current={row.key === selectedKey ? "true" : undefined}>
                <Thumb ad={ad} />
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
                    <span className={s.swatch} style={{ background: PLATFORM_COLORS[ad.platform] }} />
                    {ad.name}
                  </span>
                </div>
                <VerdictFlag signal={signal} />
                <div className={s.creativeStats}>
                  <div><b>{roas(row.roas)}</b><span>ROAS</span></div>
                  <div><b>{money(row.spend, cur, { compact: true })}</b><span>Spend</span></div>
                  <div><b>{pct(row.ctr, 2)}</b><span>CTR</span></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

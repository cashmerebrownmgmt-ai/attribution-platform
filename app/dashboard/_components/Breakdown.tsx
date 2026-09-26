import { Suspense } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LEVEL_LABELS, type EntityInfo } from "@/lib/dashboard/entity";
import { money, num, pct, roas, signedPct } from "@/lib/dashboard/format";
import { factors, FACTOR_LABELS, type Breakdown, type Effect, type Finding, type ResponseModel } from "@/lib/metrics/drivers";
import { VERDICT_LABELS } from "@/lib/metrics/signals";
import s from "../dashboard.module.css";
import { MetaPreview } from "./MetaPreview";
import { ScrollLock } from "./ScrollLock";
import { AdPreview } from "./AdPreview";
import { PLATFORM_COLORS } from "./ui";

const EFFECT_ICON: Record<Effect, string> = { helping: "▲", hurting: "▼", neutral: "●" };
const EFFECT_CLASS: Record<Effect, string> = { helping: s.goodText, hurting: s.badText, neutral: s.muted };

// ─── Quick preview (hover card) ───────────────────────────────────────────────

export function QuickPreview({ e, currency, brand }: { e: EntityInfo; currency: string; brand: string }) {
  const helping = e.analysis.findings.filter((f) => f.effect === "helping").slice(0, 2);
  const hurting = e.analysis.findings.filter((f) => f.effect === "hurting").slice(0, 2);
  const t = e.analysis.current;
  return (
    <div className={s.quick}>
      <div className={s.quickHead}>
        {e.ad && (
          <div className={s.quickThumb}>
            <AdPreview ad={e.ad} brand={brand} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div className={s.quickKicker}>
            <span className={s.swatch} style={{ background: PLATFORM_COLORS[e.platform] }} /> {LEVEL_LABELS[e.level]} · {e.context}
          </div>
          <div className={s.quickName}>{e.name}</div>
          {e.signal && (
            <div className={s.quickVerdict}>
              {VERDICT_LABELS[e.signal.verdict]}: <span className={s.muted}>{e.signal.headline}</span>
            </div>
          )}
        </div>
      </div>
      <div className={s.quickStats}>
        <div><b>{roas(e.analysis.roas.current)}</b><span>ROAS</span></div>
        <div><b>{money(t.spend, currency, { compact: true })}</b><span>Spend</span></div>
        <div><b>{money(t.revenue, currency, { compact: true })}</b><span>Revenue</span></div>
        <div><b>{money(t.orders ? t.spend / t.orders : null, currency)}</b><span>CPA</span></div>
      </div>
      <FindingList title="Helping" items={helping} empty="Nothing stands out." compact />
      <FindingList title="Hurting" items={hurting} empty="Nothing stands out." compact />
      <div className={s.quickFoot}>Click for the full breakdown</div>
    </div>
  );
}

export function FindingList({ title, items, empty, compact = false }: { title: string; items: Finding[]; empty: string; compact?: boolean }) {
  return (
    <div className={compact ? s.findingsCompact : s.findings}>
      <div className={s.findingsTitle}>{title}</div>
      {items.length === 0 ? (
        <div className={s.muted} style={{ fontSize: 12 }}>{empty}</div>
      ) : (
        <ul>
          {items.map((f) => (
            <li key={f.title}>
              <span className={EFFECT_CLASS[f.effect]} aria-label={f.effect}>{EFFECT_ICON[f.effect]}</span>
              <span>
                <strong>{f.title}</strong>
                {!compact || f.detail.length < 90 ? <span className={s.findingDetail}> {f.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Full breakdown drawer ────────────────────────────────────────────────────

export function BreakdownDrawer({
  e,
  currency,
  brand,
  closeHref,
  actions,
  children,
  targets,
}: {
  e: EntityInfo;
  currency: string;
  brand: string;
  closeHref: string;
  actions?: ReactNode;
  children?: ReactNode;
  targets: { targetRoas: number | null; breakevenRoas: number | null };
}) {
  const a = e.analysis;
  const cur = a.current;
  const prev = a.previous;
  const f1 = factors(cur);
  const f0 = factors(prev);
  const helping = a.findings.filter((x) => x.effect === "helping");
  const hurting = a.findings.filter((x) => x.effect === "hurting");
  const notes = a.findings.filter((x) => x.effect === "neutral");

  return (
    <div className={s.drawerWrap} role="dialog" aria-modal="true" aria-label={`${e.name} breakdown`}>
      <ScrollLock />
      <Link href={closeHref} className={s.lightboxBackdrop} scroll={false} aria-label="Close" tabIndex={-1} />
      <aside className={s.drawer}>
        <div className={s.lightboxBar}>
          <div style={{ minWidth: 0 }}>
            <div className={s.quickKicker}>
              <span className={s.swatch} style={{ background: PLATFORM_COLORS[e.platform] }} /> {LEVEL_LABELS[e.level]} · {e.context}
              {e.status !== "active" && <span className={s.statusChip}>{e.status}</span>}
            </div>
            <div className={s.drawerTitle}>{e.name}</div>
          </div>
          <span style={{ display: "flex", gap: 6, flex: "none" }}>
            {actions}
            <Link className={`${s.button} ${s.closeButton}`} href={closeHref} scroll={false} autoFocus aria-label="Close">
              Close ✕
            </Link>
          </span>
        </div>

        <div className={s.drawerBody}>
          {e.ad && (
            <div className={s.drawerAd}>
              <div className={s.lightboxMedia}>
                {e.ad.platform === "meta" && !e.ad.thumbnailUrl?.startsWith("demo:") ? (
                  <Suspense fallback={<div className={s.empty}>Loading Meta&apos;s preview…</div>}>
                    <MetaPreview adId={e.ad.id} format="MOBILE_FEED_STANDARD" fallback={<AdPreview ad={e.ad} brand={brand} size="large" />} />
                  </Suspense>
                ) : (
                  <AdPreview ad={e.ad} brand={brand} size="large" />
                )}
              </div>
            </div>
          )}

          {e.signal && (
            <div className={s.callout} style={{ marginBottom: 0 }}>
              <strong>{VERDICT_LABELS[e.signal.verdict]}:</strong> {e.signal.headline}. {e.signal.reasons.join(". ")}.
            </div>
          )}

          <div className={s.drawerKpis}>
            <Metric label="ROAS" value={roas(a.roas.current)} cur={a.roas.current} prev={a.roas.previous} />
            <Metric label="Spend" value={money(cur.spend, currency)} cur={cur.spend} prev={prev.spend} neutral />
            <Metric label="Revenue" value={money(cur.revenue, currency)} cur={cur.revenue} prev={prev.revenue} />
            <Metric label="Orders" value={num(cur.orders)} cur={cur.orders} prev={prev.orders} />
            <Metric label="CPA" value={money(cur.orders ? cur.spend / cur.orders : null, currency)} cur={cur.orders ? cur.spend / cur.orders : null} prev={prev.orders ? prev.spend / prev.orders : null} upIsGood={false} />
            <Metric label="CTR" value={pct(f1.ctr, 2)} cur={f1.ctr} prev={f0.ctr} />
            <Metric label="Conv. rate" value={pct(f1.cvr, 2)} cur={f1.cvr} prev={f0.cvr} />
            <Metric label="CPM" value={money(f1.cpm, currency, { cents: true })} cur={f1.cpm} prev={f0.cpm} upIsGood={false} />
          </div>

          <div className={s.grid2} style={{ marginBottom: 0 }}>
            <FindingList title="What's helping" items={helping} empty="Nothing is clearly helping yet." />
            <FindingList title="What's hurting" items={hurting} empty="Nothing is clearly hurting." />
          </div>
          {notes.length > 0 && <FindingList title="Worth knowing" items={notes} empty="" />}

          <section>
            <h3 className={s.cardTitle}>Why ROAS changed vs the previous period</h3>
            <p className={s.cardSub}>ROAS = click-through rate × conversion rate × order value ÷ CPM, so each factor&apos;s share of the change is exact.</p>
            {a.drivers ? <Waterfall a={a} /> : <div className={s.empty}>Needs spend and orders in both periods to compare.</div>}
          </section>

          <section>
            <h3 className={s.cardTitle}>Compared with similar {e.level === "ad" ? "ads" : e.level === "adGroup" ? "ad sets" : e.level === "campaign" ? "campaigns" : "platforms"}</h3>
            <p className={s.cardSub}>Versus the median of {a.benchmarks[0]?.peers ?? 0} others{e.level === "platform" ? "" : " on the same platform"}, same date range.</p>
            <Benchmarks a={a} currency={currency} />
          </section>

          <section>
            <h3 className={s.cardTitle}>What would more budget do?</h3>
            <p className={s.cardSub}>Statistical model of spend vs revenue over the last 60 days (3-day periods), fit on a log scale to capture diminishing returns.</p>
            {a.model ? <ResponseCurve m={a.model} currency={currency} targets={targets} /> : <div className={s.empty}>Not enough varied spend history to model yet (needs about 3–4 weeks).</div>}
          </section>

          {children}
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value, cur, prev, upIsGood = true, neutral = false }: { label: string; value: string; cur: number | null; prev: number | null; upIsGood?: boolean; neutral?: boolean }) {
  const d = cur !== null && prev ? cur / prev - 1 : null;
  const cls = d === null || neutral || Math.abs(d) < 0.005 ? s.muted : d > 0 === upIsGood ? s.goodText : s.badText;
  return (
    <div>
      <b>{value}</b>
      <span>{label}</span>
      <span className={cls} style={{ fontSize: 10.5 }}>{d === null ? "—" : signedPct(d)}</span>
    </div>
  );
}

/** ROAS bridge: previous ROAS → each factor's contribution → current ROAS. */
function Waterfall({ a }: { a: Breakdown }) {
  const steps = a.drivers!;
  const start = a.roas.previous!;
  const end = a.roas.current!;
  const bars: { label: string; from: number; to: number; kind: "total" | Effect; value: number }[] = [{ label: "Previous", from: 0, to: start, kind: "total", value: start }];
  let level = start;
  for (const d of steps) {
    bars.push({ label: FACTOR_LABELS[d.factor].replace("Cost per 1,000 impressions", "CPM"), from: level, to: level + d.roasImpact, kind: d.effect, value: d.roasImpact });
    level += d.roasImpact;
  }
  bars.push({ label: "Now", from: 0, to: end, kind: "total", value: end });

  const W = 560;
  const H = 190;
  const padL = 36;
  const padB = 34;
  const max = Math.max(...bars.map((b) => Math.max(b.from, b.to))) * 1.12;
  const y = (v: number) => (H - padB) - (v / max) * (H - padB - 10);
  const band = (W - padL) / bars.length;
  const bw = Math.min(46, band * 0.62);
  const color = (k: string) => (k === "total" ? "var(--s1)" : k === "helping" ? "var(--good)" : k === "hurting" ? "var(--critical)" : "var(--axis)");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.svgFull} role="img" aria-label={`ROAS went from ${start.toFixed(2)} to ${end.toFixed(2)}`}>
      <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className={s.baseline} />
      {bars.map((b, i) => {
        const x = padL + band * i + (band - bw) / 2;
        const top = y(Math.max(b.from, b.to));
        const h = Math.max(1.5, Math.abs(y(b.from) - y(b.to)));
        const text = b.kind === "total" ? `${b.value.toFixed(2)}×` : `${b.value >= 0 ? "+" : "−"}${Math.abs(b.value).toFixed(2)}×`;
        return (
          <g key={b.label}>
            <rect x={x} y={top} width={bw} height={h} rx={3} fill={color(b.kind)} className={s.fadeIn}>
              <title>{`${b.label}: ${text}`}</title>
            </rect>
            <text x={x + bw / 2} y={top - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
              {text}
            </text>
            <text x={x + bw / 2} y={H - padB + 14} textAnchor="middle" className={s.tick}>
              {b.label.split(" ")[0]}
            </text>
            <text x={x + bw / 2} y={H - padB + 26} textAnchor="middle" className={s.tick}>
              {b.label.split(" ").slice(1).join(" ")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Benchmarks({ a, currency }: { a: Breakdown; currency: string }) {
  const fmt = (factor: string, v: number | null) =>
    factor === "roas" ? roas(v) : factor === "aov" || factor === "cpm" ? money(v, currency, { cents: factor === "cpm" }) : pct(v, 2);
  const label = (factor: string) => (factor === "roas" ? "ROAS" : factor === "cpm" ? "CPM (lower is better)" : FACTOR_LABELS[factor as keyof typeof FACTOR_LABELS]);
  const rows = a.benchmarks.filter((b) => b.peerMedian !== null);
  if (rows.length === 0 || (a.benchmarks[0]?.peers ?? 0) === 0) return <div className={s.empty}>No comparable peers with spend in this range.</div>;
  return (
    <div className={s.benchRows}>
      {rows.map((b) => {
        const better = b.diff === null ? 0 : b.factor === "cpm" ? -b.diff : b.diff;
        const w = Math.min(50, Math.abs(better) * 50);
        return (
          <div key={b.factor} className={s.benchRow}>
            <span className={s.benchLabel}>{label(b.factor)}</span>
            <span className={s.benchTrack} aria-hidden="true">
              <span className={s.benchMid} />
              <span className={s.benchFill} style={{ left: better >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: better >= 0 ? "var(--good)" : "var(--critical)" }} />
            </span>
            <span className={s.benchValue}>
              {fmt(b.factor, b.value)} <span className={s.muted}>vs {fmt(b.factor, b.peerMedian)}</span>{" "}
              <span className={EFFECT_CLASS[b.effect]}>{b.diff === null ? "" : signedPct(b.diff)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ResponseCurve({ m, currency, targets }: { m: ResponseModel; currency: string; targets: { targetRoas: number | null; breakevenRoas: number | null } }) {
  const pts = m.points.filter((p) => p.spend > 0);
  const usable = pts.filter((p) => p.revenue > 0);
  const mx = usable.reduce((t, p) => t + Math.log(p.spend), 0) / usable.length;
  const my = usable.reduce((t, p) => t + Math.log(p.revenue), 0) / usable.length;
  const a = my - m.elasticity * mx; // curve through the data's center with the (clamped) slope
  const W = 560;
  const H = 200;
  const padL = 48;
  const padB = 26;
  const maxX = Math.max(...pts.map((p) => p.spend)) * 1.15;
  const maxY = Math.max(...pts.map((p) => p.revenue), Math.exp(a) * maxX ** m.elasticity) * 1.1;
  const x = (v: number) => padL + (v / maxX) * (W - padL - 8);
  const y = (v: number) => H - padB - (v / maxY) * (H - padB - 8);
  const curve = Array.from({ length: 40 }, (_, i) => {
    const sp = (maxX * (i + 1)) / 40;
    return `${i ? "L" : "M"}${x(sp).toFixed(1)},${y(Math.exp(a) * sp ** m.elasticity).toFixed(1)}`;
  }).join("");
  const be = targets.breakevenRoas ?? 1;
  const conf = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" }[m.confidence];
  const mr = m.marginalRoas;
  const verdict =
    m.confidence === "low"
      ? "The data doesn't show a reliable link between spend and revenue yet (spend barely changed, or launches and promotions moved both). Don't read too much into it."
      : mr === null
        ? ""
        : mr >= (targets.targetRoas ?? 2)
          ? `Each extra dollar is estimated to bring back about ${roas(mr)}, above your target, so there's room to raise the budget. Increase in 15–20% steps and re-check.`
          : mr < be
            ? `Extra dollars are estimated to bring back only ${roas(mr)}, below break-even. You're past the efficient point; trimming budget should raise overall ROAS.`
            : `Extra dollars return about ${roas(mr)}: still profitable but under target. Hold the budget here.`;

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.svgFull} role="img" aria-label="Spend versus revenue with fitted curve">
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className={s.baseline} />
        <line x1={x(0)} x2={x(maxX)} y1={y(0)} y2={y(be * maxX)} stroke="var(--ink-2)" strokeDasharray="4 4" strokeWidth={1} opacity={0.5} />
        <text x={x(Math.min(maxX, maxY / be)) - 2} y={y(be * Math.min(maxX, maxY / be)) + 14} className={s.tick} textAnchor="end">
          break-even
        </text>
        <path d={curve} fill="none" stroke="var(--s2)" strokeWidth={2} className={s.fadeIn} />
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.spend)} cy={y(p.revenue)} r={4} fill="var(--s1)" stroke="var(--surface)" strokeWidth={1.5}>
            <title>{`3 days: spend ${money(p.spend, currency)}, revenue ${money(p.revenue, currency)}`}</title>
          </circle>
        ))}
        <text x={padL - 6} y={y(maxY * 0.95)} className={s.tick} textAnchor="end">{money(maxY * 0.95, currency, { compact: true })}</text>
        <text x={padL - 6} y={y(0)} className={s.tick} textAnchor="end">0</text>
        <text x={x(maxX)} y={H - 6} className={s.tick} textAnchor="end">{money(maxX, currency, { compact: true })} spend / 3 days</text>
      </svg>
      <div className={s.legend} style={{ marginTop: 6 }}>
        <span className={s.legendItem}><span className={s.legendRect} style={{ background: "var(--s1)", borderRadius: "50%" }} /> 3-day periods</span>
        <span className={s.legendItem}><span className={s.legendLine} style={{ background: "var(--s2)" }} /> Fitted response</span>
        <span className={s.legendItem}>
          {conf} · R² {m.r2.toFixed(2)} · elasticity {m.elasticity.toFixed(2)} · avg ROAS {roas(m.avgRoas)} · next-dollar ROAS {roas(mr)}
        </span>
      </div>
      <p className={s.cardSub} style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{verdict}</p>
    </>
  );
}

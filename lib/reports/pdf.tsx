/**
 * Server-rendered PDF performance report (Phase 6). Built from the same pure metrics as the
 * dashboard, so the numbers always match what's on screen.
 */
import { Document, G, Line, Page, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatStoreTime } from "../tz";
import type { ReactNode } from "react";
import { MODEL_LABELS, PLATFORM_LABELS } from "../dashboard/filters";
import { CHANNEL_LABELS } from "../debug";
import { byChannel, compareKpis, ctrDecay, daily, delta, fatigue, performance, type Filters, type Kpis } from "../metrics/compute";
import { healthChecks } from "../metrics/health";
import { adSignal, VERDICT_LABELS, type Verdict } from "../metrics/signals";
import type { DashboardData } from "../metrics/types";

// Built-in Helvetica covers Latin-1 only, so formatting here sticks to ASCII-safe symbols.
const C = { ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", line: "#e1e0d9", plane: "#f6f5f1", s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", good: "#006300", bad: "#b3261e", warn: "#8a5a00" };

const st = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: C.ink },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1pt solid ${C.line}`, paddingBottom: 10, marginBottom: 14 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  sub: { color: C.ink2, marginTop: 3 },
  meta: { color: C.muted, textAlign: "right", lineHeight: 1.4 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 6, marginTop: 14 },
  hero: { flexDirection: "row", alignItems: "flex-end", marginBottom: 10 },
  heroValue: { fontSize: 26, fontFamily: "Helvetica-Bold", marginRight: 12 },
  kpis: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -3 },
  kpi: { width: "25%", padding: 3 },
  kpiBox: { backgroundColor: C.plane, borderRadius: 4, padding: 7 },
  kpiLabel: { color: C.muted, fontSize: 7.5 },
  kpiValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  kpiDelta: { fontSize: 7.5, marginTop: 2 },
  table: { borderTop: `1pt solid ${C.line}` },
  tr: { flexDirection: "row", borderBottom: `0.5pt solid ${C.line}`, paddingVertical: 4 },
  th: { color: C.muted, fontSize: 7, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  cellName: { flex: 3, paddingRight: 6 },
  cell: { flex: 1, textAlign: "right" },
  legend: { flexDirection: "row", gap: 12, marginBottom: 4, color: C.ink2, fontSize: 7.5 },
  swatch: { width: 7, height: 7, borderRadius: 1.5, marginRight: 4 },
  footer: { position: "absolute", bottom: 18, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", color: C.muted, fontSize: 7 },
  note: { color: C.ink2, fontSize: 8, lineHeight: 1.4 },
  demo: { backgroundColor: "#fff4d6", color: C.warn, padding: 6, borderRadius: 4, marginBottom: 10, fontSize: 8 },
});

const money = (n: number | null, cur: string, dp = 0) =>
  n === null || !Number.isFinite(n) ? "-" : new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: dp, minimumFractionDigits: dp }).format(n);
const x = (n: number | null) => (n === null || !Number.isFinite(n) ? "-" : `${n.toFixed(2)}x`);
const pct = (n: number | null, dp = 1) => (n === null || !Number.isFinite(n) ? "-" : `${(n * 100).toFixed(dp)}%`);
const num = (n: number) => n.toLocaleString("en-US");
const niceDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function Delta({ cur, prev, upIsGood = true, neutral = false }: { cur: number | null; prev: number | null; upIsGood?: boolean; neutral?: boolean }) {
  const d = delta(cur, prev);
  if (d === null) return <Text style={[st.kpiDelta, { color: C.muted }]}>- vs prev.</Text>;
  const color = neutral || Math.abs(d) < 0.005 ? C.muted : d > 0 === upIsGood ? C.good : C.bad;
  return <Text style={[st.kpiDelta, { color }]}>{`${d >= 0 ? "+" : "-"}${Math.abs(d * 100).toFixed(1)}% vs prev.`}</Text>;
}

function Kpi({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <View style={st.kpi}>
      <View style={st.kpiBox}>
        <Text style={st.kpiLabel}>{label}</Text>
        <Text style={st.kpiValue}>{value}</Text>
        {children}
      </View>
    </View>
  );
}

function Table({ head, rows, widths, leftCols = [0] }: { head: string[]; rows: (string | { text: string; color?: string })[][]; widths?: number[]; leftCols?: number[] }) {
  const flex = (i: number) => widths?.[i] ?? (i === 0 ? 3 : 1);
  const align = (i: number) => ({ textAlign: leftCols.includes(i) ? ("left" as const) : ("right" as const) });
  return (
    <View style={st.table}>
      <View style={st.tr} fixed>
        {head.map((h, i) => (
          <Text key={h} style={[st.th, i === 0 ? st.cellName : st.cell, { flex: flex(i) }, align(i)]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={st.tr} wrap={false}>
          {r.map((c, i) => {
            const cell = typeof c === "string" ? { text: c } : c;
            return (
              <Text key={i} style={[i === 0 ? st.cellName : st.cell, { flex: flex(i) }, align(i), cell.color ? { color: cell.color } : {}]}>
                {cell.text}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** Daily revenue (columns) with ad spend (line-ish columns) on one currency scale. */
function DailyChart({ points, cur }: { points: { date: string; revenue: number; spend: number }[]; cur: string }) {
  const W = 531;
  const H = 120;
  const left = 38;
  const bottom = 14;
  const max = Math.max(1, ...points.map((p) => Math.max(p.revenue, p.spend)));
  const step = 10 ** Math.floor(Math.log10(max / 4));
  const tick = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s >= max / 4) ?? step * 10;
  const top = Math.ceil(max / tick) * tick;
  const iw = W - left;
  const ih = H - bottom;
  const band = iw / Math.max(1, points.length);
  const bw = Math.max(1, Math.min(10, band * 0.38));
  const y = (v: number) => ih - (v / top) * ih;
  const ticks = Array.from({ length: Math.round(top / tick) + 1 }, (_, i) => i * tick);
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  return (
    <View>
      <View style={st.legend}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[st.swatch, { backgroundColor: C.s1 }]} />
          <Text>Revenue</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[st.swatch, { backgroundColor: C.s2 }]} />
          <Text>Ad spend</Text>
        </View>
      </View>
      <View style={{ position: "relative", height: H }}>
        <Svg width={W} height={H}>
          {ticks.map((t) => (
            <Line key={t} x1={left} x2={W} y1={y(t)} y2={y(t)} strokeWidth={0.5} stroke={t === 0 ? "#c3c2b7" : C.line} />
          ))}
          {points.map((p, i) => {
            const cx = left + band * i + band / 2;
            return (
              <G key={p.date}>
                <Rect x={cx - bw - 0.5} y={y(p.revenue)} width={bw} height={Math.max(0, ih - y(p.revenue))} fill={C.s1} />
                <Rect x={cx + 0.5} y={y(p.spend)} width={bw} height={Math.max(0, ih - y(p.spend))} fill={C.s2} />
              </G>
            );
          })}
        </Svg>
        {ticks.map((t) => (
          <Text key={t} style={{ position: "absolute", left: 0, width: left - 4, top: y(t) - 4, fontSize: 6.5, color: C.muted, textAlign: "right" }}>
            {money(t, cur).replace(/\.00$/, "")}
          </Text>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <Text key={p.date} style={{ position: "absolute", top: ih + 3, left: left + band * i + band / 2 - 20, width: 40, fontSize: 6.5, color: C.muted, textAlign: "center" }}>
              {new Date(`${p.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </Text>
          ) : null,
        )}
      </View>
    </View>
  );
}

function kpiTiles(k: Kpis, p: Kpis, cur: string, targetRoas: number | null, targetCpa: number | null) {
  return (
    <View style={st.kpis}>
      <Kpi label="Ad spend" value={money(k.spend, cur)}><Delta cur={k.spend} prev={p.spend} neutral /></Kpi>
      <Kpi label="ROAS (paid)" value={x(k.roas)}>
        <Delta cur={k.roas} prev={p.roas} />
        {targetRoas ? <Text style={[st.kpiDelta, { color: C.muted }]}>Target {x(targetRoas)}</Text> : null}
      </Kpi>
      <Kpi label="MER (blended)" value={x(k.mer)}><Delta cur={k.mer} prev={p.mer} /></Kpi>
      <Kpi label="CPA" value={money(k.cpa, cur)}>
        <Delta cur={k.cpa} prev={p.cpa} upIsGood={false} />
        {targetCpa ? <Text style={[st.kpiDelta, { color: C.muted }]}>Target {money(targetCpa, cur)}</Text> : null}
      </Kpi>
      <Kpi label="Orders" value={num(k.orders)}><Delta cur={k.orders} prev={p.orders} /></Kpi>
      <Kpi label="AOV" value={money(k.aov, cur, 2)}><Delta cur={k.aov} prev={p.aov} /></Kpi>
      <Kpi label="New customers" value={pct(k.newCustomerShare, 0)}><Delta cur={k.newCustomers} prev={p.newCustomers} /></Kpi>
      <Kpi label="New-customer ROAS" value={x(k.ncRoas)}><Delta cur={k.ncRoas} prev={p.ncRoas} /></Kpi>
    </View>
  );
}

export function ReportDocument({ data, f, generatedAt }: { data: DashboardData; f: Filters; generatedAt: string }) {
  const cur = data.settings.currency;
  const t = data.settings;
  const { current: k, previous: p } = compareKpis(data, f);
  const days = daily(data, f);
  const platforms = performance(data, f, "platform");
  const channels = byChannel(data, f);
  const ads = performance(data, f, "ad");
  const adIndex = new Map(data.ads.map((a) => [`${a.platform}:${a.id}`, a]));
  const endMs = Date.parse(`${f.range.to}T23:59:59Z`);
  const signals = ads.flatMap((row) => {
    const ad = adIndex.get(row.key);
    if (!ad) return [];
    const ageDays = ad.launchedAt ? Math.floor((endMs - Date.parse(ad.launchedAt)) / 86_400_000) : null;
    return [{ row, signal: adSignal({ row, ctrDecay: ctrDecay(fatigue(data, f.model, ad.platform, ad.id)), ageDays, settings: t }) }];
  });
  const byVerdict = (v: Verdict) => signals.filter((s) => s.signal.verdict === v);
  const topAds = ads.filter((a) => a.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const checks = healthChecks(data);
  const revDelta = delta(k.revenue, p.revenue);
  const rangeText = f.range.from === f.range.to ? niceDate(f.range.from) : `${niceDate(f.range.from)} - ${niceDate(f.range.to)}`;
  const title = t.businessName ?? "Marketing performance";

  return (
    <Document title={`${title} - performance report`} author="Attribution" creator="Attribution platform">
      <Page size="LETTER" style={st.page}>
        <View style={st.header}>
          <View>
            <Text style={st.title}>{title}</Text>
            <Text style={st.sub}>Marketing performance report</Text>
          </View>
          <View>
            <Text style={[st.meta, { color: C.ink, fontFamily: "Helvetica-Bold" }]}>{rangeText}</Text>
            <Text style={st.meta}>
              {MODEL_LABELS[f.model]} attribution{f.platform !== "all" ? ` - ${PLATFORM_LABELS[f.platform]}` : ""}
            </Text>
            <Text style={st.meta}>Generated {generatedAt}</Text>
          </View>
        </View>
        {data.mode === "demo" && <Text style={st.demo}>DEMO DATA: this report uses generated sample data, not your store&apos;s real numbers.</Text>}

        <View style={st.hero}>
          <Text style={st.heroValue}>{money(k.revenue, cur)}</Text>
          <Text style={{ color: C.ink2, marginBottom: 4 }}>
            revenue · {revDelta === null ? "-" : `${revDelta >= 0 ? "+" : "-"}${Math.abs(revDelta * 100).toFixed(1)}%`} vs previous period · {num(k.orders)} orders
          </Text>
        </View>
        {kpiTiles(k, p, cur, t.targetRoas, t.targetCpa)}

        <Text style={st.h2}>Revenue and ad spend by day</Text>
        <DailyChart points={days} cur={cur} />

        <Text style={st.h2}>Ad platforms</Text>
        <Table
          head={["Platform", "Spend", "Revenue", "ROAS", "Platform ROAS", "CPA", "CTR", "Orders"]}
          rows={platforms.map((r) => [
            PLATFORM_LABELS[r.platform],
            money(r.spend, cur),
            money(r.revenue, cur),
            { text: x(r.roas), color: t.targetRoas && r.roas !== null ? (r.roas >= t.targetRoas ? C.good : C.bad) : undefined },
            x(r.platformRoas),
            money(r.cpa, cur),
            pct(r.ctr, 2),
            num(r.orders),
          ])}
        />
        <Text style={[st.note, { marginTop: 4 }]}>Platform ROAS is what each ad platform reports; platforms often claim the same sale, so it runs higher than first-party ROAS.</Text>

        <Footer />
      </Page>

      <Page size="LETTER" style={st.page}>
        <Text style={[st.h2, { marginTop: 0 }]}>Revenue by channel</Text>
        <Table
          head={["Channel", "Revenue", "Share", "Orders", "New customers"]}
          rows={channels.map((c) => [CHANNEL_LABELS[c.channel] ?? c.channel, money(c.revenue, cur), pct(c.share, 0), num(c.orders), num(c.newCustomers)])}
        />

        <Text style={st.h2}>Top ads by revenue</Text>
        <Table
          head={["Ad", "Platform", "Spend", "Revenue", "ROAS", "CPA"]}
          widths={[3.2, 1, 1, 1, 0.8, 0.8]}
          rows={topAds.map((a) => [a.name, PLATFORM_LABELS[a.platform], money(a.spend, cur), money(a.revenue, cur), { text: x(a.roas), color: t.targetRoas && a.roas !== null ? (a.roas >= t.targetRoas ? C.good : C.bad) : undefined }, money(a.cpa, cur)])}
        />

        <Text style={st.h2}>Recommended actions</Text>
        {(["scale", "refresh", "pause", "watch"] as Verdict[]).map((v) =>
          byVerdict(v).length ? (
            <View key={v} style={{ marginBottom: 8 }} wrap={false}>
              <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 3, color: v === "scale" ? C.good : v === "pause" ? C.bad : C.warn }}>
                {VERDICT_LABELS[v]} ({byVerdict(v).length})
              </Text>
              {byVerdict(v).map(({ row, signal }) => (
                <Text key={row.key} style={[st.note, { marginBottom: 2 }]}>
                  - {row.name} ({PLATFORM_LABELS[row.platform]}): {signal.reasons.join("; ").replace(/×/g, "x").replace(/[−–]/g, "-").replace(/:\s/g, " - ")}
                </Text>
              ))}
            </View>
          ) : null,
        )}

        <View wrap={false}>
        <Text style={st.h2}>Tracking health</Text>
        <Table
          head={["Check", "Status", "Detail"]}
          widths={[1.4, 0.7, 3.6]}
          leftCols={[0, 1, 2]}
          rows={checks.map((c) => [c.name, { text: c.level === "ok" ? "OK" : c.level === "warn" ? "Warning" : "Problem", color: c.level === "ok" ? C.good : c.level === "warn" ? C.warn : C.bad }, c.detail.replace(/[−–]/g, "-")])}
        />
        </View>
        <Footer />
      </Page>
    </Document>
  );
}

function Footer() {
  return (
    <View style={st.footer} fixed>
      <Text>First-party attribution · numbers reflect orders matched by the attribution platform</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

export async function renderReport(data: DashboardData, f: Filters): Promise<Buffer> {
  const generatedAt = formatStoreTime(Date.now(), { dateStyle: "medium", timeStyle: "short" }) + " ET";
  return renderToBuffer(<ReportDocument data={data} f={f} generatedAt={generatedAt} />);
}

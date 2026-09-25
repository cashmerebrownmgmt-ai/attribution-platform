/** The daily report as a downloadable PDF, rendered from the same snapshot as the page. */
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { longDay, type DailyReport, type ReportKpi } from "../daily-report";
import { PLATFORM_LABELS } from "../dashboard/filters";
import { VERDICT_LABELS } from "../metrics/signals";
import type { Platform } from "../metrics/types";

const C = {
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#898781",
  line: "#e1e0d9",
  plane: "#f6f5f1",
  good: "#006300",
  bad: "#b3261e",
  warn: "#8a5a00",
};

const st = StyleSheet.create({
  page: {
    padding: 32,
    paddingBottom: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: C.ink,
  },
  header: {
    borderBottom: `1pt solid ${C.line}`,
    paddingBottom: 10,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  sub: { color: C.ink2, marginTop: 3 },
  h2: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
    marginTop: 14,
  },
  bullet: { flexDirection: "row", marginBottom: 3 },
  line: { flex: 1 },
  kpis: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -3 },
  kpi: { width: "33.33%", padding: 3 },
  kpiBox: { backgroundColor: C.plane, borderRadius: 4, padding: 7 },
  kpiLabel: { color: C.muted, fontSize: 7.5 },
  kpiValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  small: { fontSize: 7.5, marginTop: 2 },
  tr: {
    flexDirection: "row",
    borderBottom: `0.5pt solid ${C.line}`,
    paddingVertical: 4,
  },
  th: {
    color: C.muted,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  note: { color: C.ink2, fontSize: 8, lineHeight: 1.4 },
  demo: {
    backgroundColor: "#fff4d6",
    color: C.warn,
    padding: 6,
    borderRadius: 4,
    marginBottom: 10,
    fontSize: 8,
  },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 32,
    right: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    color: C.muted,
    fontSize: 7,
  },
});

/** Built-in Helvetica covers Latin-1 only: swap the few symbols we use for plain ones. */
export const ascii = (t: string) =>
  t
    .replace(/×/g, "x")
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(
      /[▲▼→←·•]/g,
      (c) =>
        ({ "▲": "+", "▼": "-", "→": "->", "←": "<-", "·": "-", "•": "-" })[c]!,
    )
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");

const money = (n: number | null, cur: string, dp = 0) =>
  n === null || !Number.isFinite(n)
    ? "-"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: cur,
        maximumFractionDigits: dp,
        minimumFractionDigits: dp,
      }).format(n);
const x = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "-" : `${n.toFixed(2)}x`;
const pct = (n: number | null, dp = 1) =>
  n === null || !Number.isFinite(n) ? "-" : `${(n * 100).toFixed(dp)}%`;

function fmt(k: ReportKpi, v: number | null, cur: string) {
  if (k.kind === "money") return money(v, cur, k.key === "aov" ? 2 : 0);
  if (k.kind === "pct") return pct(v, 2);
  if (k.kind === "roas") return x(v);
  return v === null ? "-" : v.toLocaleString("en-US");
}

function Change({
  k,
  base,
  label,
}: {
  k: ReportKpi;
  base: number | null;
  label: string;
}) {
  const d =
    k.value === null || base === null || base === 0 ? null : k.value / base - 1;
  const color =
    d === null || Math.abs(d) < 0.005 || k.key === "adSpend"
      ? C.muted
      : d > 0 === k.upIsGood
        ? C.good
        : C.bad;
  return (
    <Text style={[st.small, { color }]}>
      {d === null
        ? `- ${label}`
        : `${d >= 0 ? "+" : "-"}${Math.abs(d * 100).toFixed(1)}% ${label}`}
    </Text>
  );
}

function Table({
  head,
  rows,
  widths,
}: {
  head: string[];
  rows: string[][];
  widths: number[];
}) {
  return (
    <View>
      <View style={st.tr}>
        {head.map((h, i) => (
          <Text
            key={h}
            style={[
              st.th,
              { flex: widths[i], textAlign: i === 0 ? "left" : "right" },
            ]}
          >
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r, j) => (
        <View key={j} style={st.tr} wrap={false}>
          {r.map((c, i) => (
            <Text
              key={i}
              style={{
                flex: widths[i],
                textAlign: i === 0 ? "left" : "right",
                paddingRight: i === 0 ? 6 : 0,
              }}
            >
              {ascii(c)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function DailyReportDocument({
  r,
  businessName,
}: {
  r: DailyReport;
  businessName: string | null;
}) {
  const cur = r.currency;
  const generated = new Date(r.generatedAt).toLocaleString("en-US", {
    timeZone: r.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <Document
      title={`Daily report ${r.day}`}
      author="Attribution"
      creator="Attribution platform"
    >
      <Page size="LETTER" style={st.page}>
        <View style={st.header}>
          <Text style={st.title}>{ascii(businessName ?? "Daily report")}</Text>
          <Text style={st.sub}>
            Daily report for {longDay(r.day)} (Eastern time) - generated{" "}
            {generated}
          </Text>
        </View>
        {r.mode === "demo" && (
          <Text style={st.demo}>
            DEMO DATA: this report uses generated sample data, not your
            store&apos;s real numbers.
          </Text>
        )}

        <Text style={[st.h2, { marginTop: 0 }]}>Summary</Text>
        {r.summary.map((line) => (
          <View key={line} style={st.bullet}>
            <Text style={{ width: 10 }}>-</Text>
            <Text style={st.line}>{ascii(line)}</Text>
          </View>
        ))}

        <Text style={st.h2}>Key numbers</Text>
        <View style={st.kpis}>
          {r.kpis.map((k) => (
            <View key={k.key} style={st.kpi} wrap={false}>
              <View style={st.kpiBox}>
                <Text style={st.kpiLabel}>{k.label}</Text>
                <Text style={st.kpiValue}>{fmt(k, k.value, cur)}</Text>
                <Change k={k} base={k.lastWeek} label="vs last week" />
                <Change k={k} base={k.avg7} label="vs 7-day avg" />
              </View>
            </View>
          ))}
        </View>

        <Text style={st.h2}>What to do today</Text>
        {r.actions.length === 0 ? (
          <Text style={st.note}>No ad needs a change today.</Text>
        ) : (
          r.actions.map((a) => (
            <View
              key={`${a.platform}:${a.name}:${a.verdict}`}
              style={st.bullet}
              wrap={false}
            >
              <Text
                style={{
                  width: 92,
                  fontFamily: "Helvetica-Bold",
                  color:
                    a.verdict === "scale"
                      ? C.good
                      : a.verdict === "pause"
                        ? C.bad
                        : C.warn,
                }}
              >
                {VERDICT_LABELS[a.verdict]}
              </Text>
              <Text style={st.line}>
                {ascii(
                  `${a.name} (${PLATFORM_LABELS[a.platform as Platform] ?? a.platform}): ${a.reasons.join("; ")}`,
                )}
              </Text>
            </View>
          ))
        )}

        <View wrap={false}>
          <Text style={st.h2}>Revenue by channel</Text>
          <Table
            head={["Channel", "Yesterday", "Daily avg. (7 days)"]}
            widths={[3, 1, 1.3]}
            rows={r.channels.map((c) => [
              c.name,
              money(c.value, cur),
              money(c.compare, cur),
            ])}
          />
        </View>

        <View wrap={false}>
          <Text style={st.h2}>Ads yesterday</Text>
          <Table
            head={["Ad", "Platform", "Spend", "Sales", "ROAS", "Platform says"]}
            widths={[3, 0.9, 0.9, 0.9, 0.7, 1]}
            rows={r.topAds.map((a) => [
              a.name,
              PLATFORM_LABELS[a.platform as Platform] ?? a.platform,
              money(a.spend, cur),
              money(a.revenue, cur),
              x(a.roas),
              x(a.platformRoas),
            ])}
          />
        </View>

        {r.products.length > 0 && (
          <View wrap={false}>
            <Text style={st.h2}>Products sold</Text>
            <Table
              head={["Product", "Sold", "Revenue"]}
              widths={[3, 1, 1]}
              rows={r.products.map((p) => [
                p.name,
                p.detail,
                money(p.value, cur),
              ])}
            />
          </View>
        )}

        {r.tips.length > 0 && (
          <Text style={st.h2}>How people shopped this week</Text>
        )}
        {r.tips.map((t) => (
          <View key={t.id} style={{ marginBottom: 8 }} wrap={false}>
            <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 2 }}>
              {ascii(t.title)}
            </Text>
            <Text style={st.note}>{ascii(t.why)}</Text>
            {t.actions.map((a) => (
              <Text key={a} style={st.note}>
                - {ascii(a)}
              </Text>
            ))}
          </View>
        ))}

        <View wrap={false}>
          <Text style={st.h2}>Tracking and alerts</Text>
          {r.alerts.map((a) => (
            <Text
              key={a.id}
              style={[
                st.note,
                { color: a.severity === "critical" ? C.bad : C.warn },
              ]}
            >
              {ascii(
                `${a.severity === "critical" ? "PROBLEM" : "WARNING"}: ${a.title}. ${a.detail}`,
              )}
            </Text>
          ))}
          {r.health.map((h) => (
            <Text key={h.name} style={st.note}>
              {ascii(
                `${h.level === "ok" ? "OK" : h.level === "warn" ? "Warning" : "Problem"} - ${h.name}: ${h.detail}`,
              )}
            </Text>
          ))}
        </View>

        <View style={st.footer} fixed>
          <Text>First-party attribution - days in Eastern time</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export function renderDailyReport(
  r: DailyReport,
  businessName: string | null,
): Promise<Buffer> {
  return renderToBuffer(
    <DailyReportDocument r={r} businessName={businessName} />,
  );
}

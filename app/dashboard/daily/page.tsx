import Link from "next/link";
import { longDay, type ReportKpi } from "@/lib/daily-report";
import { getDailyReport, listReportDays } from "@/lib/daily-report-data";
import { PLATFORM_LABELS } from "@/lib/dashboard/filters";
import { money, num, pct, roas, signedPct } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { delta } from "@/lib/metrics/compute";
import { VERDICT_LABELS } from "@/lib/metrics/signals";
import type { Platform } from "@/lib/metrics/types";
import s from "../dashboard.module.css";
import { DataTable } from "../_components/DataTable";
import { Tips } from "../_components/Tips";
import { Card, PageHead, StatusIcon } from "../_components/ui";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function fmt(k: ReportKpi, v: number | null, cur: string): string {
  if (k.kind === "money") return money(v, cur, { cents: k.key === "aov" });
  if (k.kind === "pct") return pct(v, 2);
  if (k.kind === "roas") return roas(v);
  return num(v);
}

function Compare({ k, base, label }: { k: ReportKpi; base: number | null; label: string }) {
  const d = delta(k.value, base);
  const good = d === null || Math.abs(d) < 0.005 || k.key === "adSpend" ? null : d > 0 === k.upIsGood;
  return (
    <div className={`${s.delta} ${good === null ? s.deltaFlat : good ? s.deltaGood : s.deltaBad}`}>
      {d === null ? "—" : signedPct(d)}
      <span className={s.muted} style={{ fontWeight: 400 }}>
        {" "}
        {label}
      </span>
    </div>
  );
}

export default async function DailyReportPage({ searchParams }: PageProps<"/dashboard/daily">) {
  const { mode, params } = await loadPage(searchParams);
  const wanted = one(params.day);
  const day = wanted && /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : null;
  const [result, days] = await Promise.all([getDailyReport(mode, day), mode === "live" ? listReportDays() : Promise.resolve([])]);

  if (!result) {
    return (
      <>
        <PageHead title="Daily report" mode={mode} exportable={false} />
        <div className={s.callout}>
          There&apos;s no saved report for {day ? longDay(day) : "that day"}. Reports are saved each morning from the day the feature was turned on. <Link href="/dashboard/daily">See the latest</Link>
        </div>
      </>
    );
  }

  const { report: r, saved } = result;
  const cur = r.currency;
  const idx = days.indexOf(r.day);
  const older = idx >= 0 ? days[idx + 1] : days[0];
  const newer = idx > 0 ? days[idx - 1] : null;
  const generated = new Date(r.generatedAt).toLocaleString("en-US", { timeZone: r.timezone, dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHead
        title="Daily report"
        subtitle={`${longDay(r.day)} · Eastern time`}
        mode={mode}
        exportable={false}
        action={
          <a className={`${s.button} ${s.buttonPrimary}`} href={`/dashboard/daily/pdf?day=${r.day}`} download>
            ↓ Download PDF
          </a>
        }
      />

      <div className={s.chips} style={{ marginBottom: 12 }}>
        {older && (
          <Link className={s.chip} href={`/dashboard/daily?day=${older}`}>
            ← {longDay(older)}
          </Link>
        )}
        {newer && (
          <Link className={s.chip} href={`/dashboard/daily?day=${newer}`}>
            {longDay(newer)} →
          </Link>
        )}
        <span className={s.muted} style={{ alignSelf: "center", fontSize: 12 }}>
          {saved ? `Saved ${generated}` : `Built just now (${generated}); the morning job saves a copy each day`}
        </span>
      </div>

      <Card title="Summary">
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, lineHeight: 1.5 }}>
          {r.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>
      <div style={{ height: 12 }} />

      <div className={s.kpiGrid}>
        {r.kpis.map((k) => (
          <div key={k.key} className={s.card}>
            <div className={s.kpiLabel}>{k.label}</div>
            <div className={s.kpiValue}>{fmt(k, k.value, cur)}</div>
            <Compare k={k} base={k.lastWeek} label="vs last week" />
            <Compare k={k} base={k.avg7} label="vs 7-day avg" />
          </div>
        ))}
      </div>

      <div className={s.grid2}>
        <Card title="What to do today" sub="From each ad's last 7 days, against your targets">
          {r.actions.length === 0 ? (
            <div className={s.empty}>No ad needs a change today.</div>
          ) : (
            <div className={s.statusList}>
              {r.actions.map((a) => (
                <div key={`${a.platform}:${a.name}:${a.verdict}`} className={s.statusItem}>
                  <StatusIcon level={a.verdict === "scale" ? "ok" : a.verdict === "pause" ? "bad" : "warn"} />
                  <div>
                    <div className={s.statusName}>
                      {VERDICT_LABELS[a.verdict]}: {a.name} <span className={s.muted}>({PLATFORM_LABELS[a.platform as Platform] ?? a.platform})</span>
                    </div>
                    <div className={s.statusDetail}>{a.reasons.join(" · ")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Revenue by channel" sub="Yesterday vs its 7-day daily average">
          <DataTable
            nameLabel="Channel"
            currency={cur}
            defaultSort="rev"
            empty="No sales yesterday."
            columns={[
              { key: "rev", label: "Yesterday", kind: "money" },
              { key: "avg", label: "Daily avg.", kind: "money" },
            ]}
            rows={r.channels.map((c) => ({ id: c.name, name: c.name, values: { rev: c.value, avg: c.compare } }))}
          />
        </Card>
      </div>

      <div className={s.grid2}>
        <Card title="Ads yesterday" sub="Top 8 by sales credited (last non-direct click)">
          <DataTable
            nameLabel="Ad"
            currency={cur}
            defaultSort="rev"
            empty="No ad activity yesterday."
            columns={[
              { key: "spend", label: "Spend", kind: "money" },
              { key: "rev", label: "Sales", kind: "money" },
              { key: "roas", label: "ROAS", kind: "roas" },
              { key: "proas", label: "Platform says", kind: "roas" },
            ]}
            rows={r.topAds.map((a) => ({ id: `${a.platform}:${a.name}`, name: a.name, values: { spend: a.spend, rev: a.revenue, roas: a.roas, proas: a.platformRoas } }))}
          />
        </Card>
        <Card title="Products sold" sub="Yesterday">
          <DataTable
            nameLabel="Product"
            currency={cur}
            defaultSort="rev"
            empty="No product details for yesterday's orders."
            columns={[
              { key: "units", label: "Sold", kind: "text" },
              { key: "rev", label: "Revenue", kind: "money" },
            ]}
            rows={r.products.map((p) => ({ id: p.name, name: p.name, values: { units: p.detail, rev: p.value } }))}
          />
        </Card>
      </div>

      <Card title="How people shopped this week" sub="Last 7 days vs the 7 before">
        <Tips tips={r.tips} open={1} />
      </Card>
      <div style={{ height: 12 }} />

      <Card title="Tracking and alerts">
        <div className={s.statusList}>
          {r.alerts.map((a) => (
            <div key={a.id} className={s.statusItem}>
              <StatusIcon level={a.severity === "critical" ? "bad" : "warn"} />
              <div>
                <div className={s.statusName}>{a.title}</div>
                <div className={s.statusDetail}>{a.detail}</div>
              </div>
            </div>
          ))}
          {r.health.map((h) => (
            <div key={h.name} className={s.statusItem}>
              <StatusIcon level={h.level} />
              <div>
                <div className={s.statusName}>{h.name}</div>
                <div className={s.statusDetail}>{h.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

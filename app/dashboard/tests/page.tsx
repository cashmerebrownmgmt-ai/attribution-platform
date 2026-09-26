import Link from "next/link";
import { longDay } from "@/lib/daily-report";
import { money, num, pct, roas } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { readTest, recommendLength, type Readout } from "@/lib/incrementality";
import { addDays } from "@/lib/metrics/compute";
import { listTests, toPlan, type StoredTest } from "@/lib/tests-data";
import { storeDay } from "@/lib/tz";
import s from "../dashboard.module.css";
import { LineChart } from "../_components/charts/LineChart";
import { Card, PageHead, StatusIcon } from "../_components/ui";
import { cancelTest, createTest, deleteTest } from "./actions";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function phase(t: StoredTest, today: string): "upcoming" | "running" | "finished" | "cancelled" {
  if (t.status === "cancelled") return "cancelled";
  if (today < t.start_date) return "upcoming";
  if (today <= t.end_date) return "running";
  return "finished";
}

const PHASE_LABEL = { upcoming: "Starts soon", running: "Running", finished: "Finished", cancelled: "Cancelled" } as const;

export default async function TestsPage({ searchParams }: PageProps<"/dashboard/tests">) {
  const { mode, data, params } = await loadPage(searchParams);
  const cur = data.settings.currency;
  const today = storeDay(Date.parse(data.generatedAt));
  const tests = mode === "live" ? await listTests() : [];
  const selected = tests.find((t) => t.id === one(params.id)) ?? null;
  const error = one(params.error);

  // What's worth testing: all of Meta, and each campaign with meaningful spend in the last 4 weeks.
  const campaigns = data.campaigns.filter((c) => c.platform === "meta");
  const base = { design: "pause" as const, cutShare: 1, start: today, baselineDays: 28, excludeEmail: true };
  const options = [
    { id: "", label: "All Meta ads", rec: recommendLength(data, { ...base, scope: { platform: "meta", campaignId: null } }, today) },
    ...campaigns.map((c) => ({ id: c.id, label: c.name, rec: recommendLength(data, { ...base, scope: { platform: "meta", campaignId: c.id } }, today) })),
  ]
    .filter((o, i) => i === 0 || o.rec.stats.spendPerDay >= 5)
    .slice(0, 8);
  const all = options[0].rec;

  return (
    <>
      <PageHead title="Incrementality tests" subtitle="Turn ads off (or down) for a while and measure how much revenue really drops" mode={mode} exportable={false} />
      {error && (
        <div className={s.callout} role="alert" style={{ borderColor: "var(--critical)" }}>
          {error}
        </div>
      )}
      {mode === "demo" && <div className={s.callout}>Tests run on your live data. Switch to Live data to plan one.</div>}

      {selected ? (
        <TestDetail t={selected} r={readTest(data, toPlan(selected), today)} today={today} cur={cur} campaignName={campaigns.find((c) => c.id === selected.campaign_id)?.name ?? null} />
      ) : (
        <>
          <Card title="How it works">
            <ol className={s.tipActions} style={{ marginTop: 0 }}>
              <li>Pick what to test and plan it here. The app suggests how long to run, based on how much your daily sales normally swing.</li>
              <li>On the start date, pause the ads (or cut the budget) in Ads Manager yourself. Turn them back on after the end date.</li>
              <li>The app predicts what sales would have been from the 4 weeks before, adjusted for day of week, and measures the real drop. Email/SMS-driven sales are left out because they swing a lot and don&apos;t depend on ads.</li>
              <li>You get the revenue the ads were really creating, with a 90% range, next to what Meta claims.</li>
            </ol>
          </Card>
          <div style={{ height: 12 }} />

          <div className={s.grid2}>
            <Card title="What's worth testing" sub="Last 4 weeks. For a full pause: the length needed to detect 80% of what Meta claims, and the smallest daily drop that length can detect.">
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Spend/day</th>
                      <th>Meta claims/day</th>
                      <th>Suggested</th>
                      <th>Can detect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {options.map((o) => (
                      <tr key={o.id || "all"}>
                        <td>{o.label}</td>
                        <td>{money(o.rec.stats.spendPerDay, cur)}</td>
                        <td>{money(o.rec.stats.claimedPerDay, cur)}</td>
                        <td>{o.rec.feasible ? `${o.rec.days} days` : "Too small alone"}</td>
                        <td>{Number.isFinite(o.rec.detectable) ? `${money(o.rec.detectable, cur)}/day` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={s.cardSub} style={{ marginTop: 8 }}>
                Your non-email sales average {money(all.baseline.mean, cur)}/day and typically swing ±{money(all.baseline.sd, cur)}, so only big drops stand out. If Meta&apos;s claim is mostly real, a test of all Meta ads will show it; if sales barely move, the result still caps how much of the claim is real. Small campaigns can&apos;t be measured on their own.
              </p>
            </Card>

            <Card title="Plan a test">
              <form action={createTest} className={s.form}>
                <fieldset disabled={mode !== "live"} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
                  <div className={s.field}>
                    <label htmlFor="campaign_id">What to test</label>
                    <select id="campaign_id" name="campaign_id" defaultValue="">
                      {options.map((o) => (
                        <option key={o.id || "all"} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                    <div className={s.field}>
                      <label htmlFor="design">Design</label>
                      <select id="design" name="design" defaultValue="pause">
                        <option value="pause">Pause completely</option>
                        <option value="cut">Cut the budget</option>
                      </select>
                    </div>
                    <div className={s.field}>
                      <label htmlFor="cut_share">Cut by (if cutting)</label>
                      <select id="cut_share" name="cut_share" defaultValue="0.5">
                        <option value="0.25">25%</option>
                        <option value="0.5">50%</option>
                        <option value="0.75">75%</option>
                      </select>
                    </div>
                    <div className={s.field}>
                      <label htmlFor="start_date">Start date</label>
                      <input id="start_date" name="start_date" type="date" min={today} defaultValue={addDays(today, 1)} required />
                    </div>
                    <div className={s.field}>
                      <label htmlFor="days">Length (days)</label>
                      <input id="days" name="days" type="number" min={7} max={60} defaultValue={all.feasible ? all.days : 21} required />
                    </div>
                  </div>
                  <div className={s.field}>
                    <label htmlFor="name">Name</label>
                    <input id="name" name="name" placeholder="e.g. Meta pause, October" maxLength={120} />
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" name="exclude_email" defaultChecked /> Leave out email/SMS-driven sales (recommended)
                  </label>
                  <div className={s.field}>
                    <label htmlFor="notes">Notes</label>
                    <textarea id="notes" name="notes" rows={2} maxLength={2000} placeholder="Anything that might affect sales during the test (a launch, a sale)…" />
                  </div>
                  <div>
                    <button className={`${s.button} ${s.buttonPrimary}`} type="submit">
                      Plan test
                    </button>
                  </div>
                  <p className={s.hint} style={{ margin: 0 }}>
                    Budget cuts disrupt less but need longer, since the drop is smaller. Avoid running a sale or launch during the test.
                  </p>
                </fieldset>
              </form>
            </Card>
          </div>

          <Card title="Your tests">
            {tests.length === 0 ? (
              <div className={s.empty}>{one(params.deleted) ? "Test deleted." : "No tests yet."}</div>
            ) : (
              <div className={s.statusList}>
                {tests.map((t) => {
                  const ph = phase(t, today);
                  const r = ph === "running" || ph === "finished" ? readTest(data, toPlan(t), today) : null;
                  return (
                    <Link key={t.id} href={`/dashboard/tests?id=${t.id}`} className={s.statusItem} style={{ textDecoration: "none", color: "inherit" }}>
                      <StatusIcon level={ph === "finished" ? (r?.significant ? "ok" : "warn") : ph === "cancelled" ? "bad" : "warn"} />
                      <div>
                        <div className={s.statusName}>
                          {t.name} <span className={s.muted}>· {PHASE_LABEL[ph]}</span>
                        </div>
                        <div className={s.statusDetail}>
                          {longDay(t.start_date)} – {longDay(t.end_date)}
                          {r && r.daysMeasured > 0 ? ` · ${r.daysMeasured} of ${r.daysPlanned} days measured` : ""}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function TestDetail({ t, r, today, cur, campaignName }: { t: StoredTest; r: Readout; today: string; cur: string; campaignName: string | null }) {
  const ph = phase(t, today);
  const target = t.campaign_id ? `the campaign “${campaignName ?? t.campaign_id}”` : "all Meta ads";
  const action = t.design === "pause" ? `Pause ${target}` : `Cut the budget of ${target} by ${Math.round(t.cut_share * 100)}%`;
  const cumulative = (xs: number[]) => {
    let c = 0;
    return xs.map((x) => (c += x));
  };
  const spendDidntDrop = r.daysMeasured >= 3 && r.spendSaved < 0.3 * (r.claimedDuring / Math.max(0.01, r.claimedRoas ?? 1));

  return (
    <>
      <p style={{ margin: "0 0 12px" }}>
        <Link href="/dashboard/tests" className={s.muted}>
          ← All tests
        </Link>
      </p>
      <Card title={t.name} sub={`${PHASE_LABEL[ph]} · ${longDay(t.start_date)} – ${longDay(t.end_date)} · baseline: the ${t.baseline_days} days before`}>
        {ph === "upcoming" && (
          <ol className={s.tipActions} style={{ marginTop: 0 }}>
            <li>
              <b>{longDay(t.start_date)}:</b> {action} in Ads Manager, first thing in the morning.
            </li>
            <li>Leave everything else as normal (no sales, launches or big email pushes if you can).</li>
            <li>
              <b>{longDay(addDays(t.end_date, 1))}:</b> turn it back to how it was.
            </li>
          </ol>
        )}
        {ph !== "upcoming" && <p style={{ margin: 0, lineHeight: 1.5 }}>{r.verdict}</p>}
        {spendDidntDrop && ph !== "cancelled" && (
          <div className={s.callout} style={{ marginTop: 10, marginBottom: 0 }}>
            Meta spend hasn&apos;t dropped during the test. Check the {t.design === "pause" ? "pause" : "budget cut"} was applied in Ads Manager, or results won&apos;t mean anything.
          </div>
        )}
        {t.notes && <p className={s.cardSub} style={{ marginTop: 10 }}>Notes: {t.notes}</p>}
      </Card>
      <div style={{ height: 12 }} />

      {r.daysMeasured > 0 && (
        <>
          <div className={s.kpiGrid}>
            {[
              ["Revenue the ads were creating", money(r.lift, cur), `90% range ${money(r.liftLow, cur)} to ${money(r.liftHigh, cur)}`],
              ["Meta claimed over the same days", money(r.claimedDuring, cur), r.realShare !== null ? `${pct(Math.max(0, r.realShare), 0)} of it was real` : ""],
              ["Real return on spend removed", roas(r.incrementalRoas), `Meta claims ${roas(r.claimedRoas)}`],
              ["Spend removed", money(r.spendSaved, cur), `${num(r.daysMeasured)} of ${num(r.daysPlanned)} days measured`],
            ].map(([label, value, foot]) => (
              <div key={label} className={s.card}>
                <div className={s.kpiLabel}>{label}</div>
                <div className={s.kpiValue}>{value}</div>
                <div className={s.kpiTarget}>{foot}</div>
              </div>
            ))}
          </div>

          <div className={s.grid2}>
            <Card title="Expected vs actual sales" sub={`Daily, ${t.exclude_email ? "without email/SMS-driven sales" : "all sales"}`}>
              <LineChart
                label="Expected vs actual daily sales"
                dates={r.daily.map((d) => d.date)}
                kind="money"
                currency={cur}
                series={[
                  { name: "Expected (no change)", color: "var(--ink-2)", values: r.daily.map((d) => d.expected), dashed: true },
                  { name: "Actual", color: "var(--s1)", values: r.daily.map((d) => d.actual), area: true },
                ]}
              />
            </Card>
            <Card title="Running total of the difference" sub="Expected minus actual, added up. A line climbing steadily means the ads were creating sales.">
              <LineChart
                label="Cumulative lift"
                dates={r.daily.map((d) => d.date)}
                kind="money"
                currency={cur}
                series={[{ name: "Revenue the ads were creating", color: "var(--s2)", values: cumulative(r.daily.map((d) => d.expected - d.actual)) }]}
              />
            </Card>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {ph !== "cancelled" && ph !== "finished" && (
          <form action={cancelTest}>
            <input type="hidden" name="id" value={t.id} />
            <button className={s.button} type="submit">
              Cancel test
            </button>
          </form>
        )}
        <form action={deleteTest}>
          <input type="hidden" name="id" value={t.id} />
          <button className={`${s.button} ${s.buttonGhost}`} type="submit">
            Delete
          </button>
        </form>
      </div>
      <p className={s.hint} style={{ marginTop: 10 }}>
        How it&apos;s measured: expected sales come from the {t.baseline_days} days before the test, adjusted for day of week. The range reflects normal day-to-day swings. A sale, launch or big email during the test can skew the result. For large budgets, Meta&apos;s own Conversion Lift studies (via your Meta rep) are the gold standard.
      </p>
    </>
  );
}

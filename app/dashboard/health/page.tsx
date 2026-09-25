import { alertsFor } from "@/lib/alerts";
import { loadPage } from "@/lib/dashboard/page";
import { emailConfigured } from "@/lib/email";
import { healthChecks, overallLevel } from "@/lib/metrics/health";
import s from "../dashboard.module.css";
import { Columns } from "../_components/charts/Columns";
import { DataTable } from "../_components/DataTable";
import { Card, PageHead, StatusIcon, TableToggle } from "../_components/ui";

const SUMMARY = {
  ok: "Everything is working. Your numbers are trustworthy.",
  warn: "Mostly working, with a few things to look at.",
  bad: "Something needs fixing. Some numbers may be incomplete.",
};

export default async function HealthPage({ searchParams }: PageProps<"/dashboard/health">) {
  const { mode, data } = await loadPage(searchParams);
  const checks = healthChecks(data);
  const overall = overallLevel(checks);
  const alerts = alertsFor(data);
  const emailOn = emailConfigured() && !!process.env.CRON_SECRET;
  const hours = data.health.eventsByHour;
  const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHead title="Tracking health" subtitle="Is the data flowing, complete and trustworthy?" mode={mode} />

      <div className={s.card} style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
        <StatusIcon level={overall} />
        <div>
          <div style={{ fontWeight: 650, fontSize: 16 }}>{SUMMARY[overall]}</div>
          <div className={s.cardSub}>
            {checks.filter((c) => c.level === "ok").length} of {checks.length} checks passing
          </div>
        </div>
      </div>

      <Card
        title="Email alerts"
        sub={
          emailOn
            ? "Checked every morning (9am Eastern). You're emailed when something breaks, and reminded once a day while it stays broken."
            : "Not sending yet: add RESEND_API_KEY and CRON_SECRET in Vercel to get these by email. They still show here."
        }
      >
        {alerts.length === 0 ? (
          <div className={s.empty}>Nothing to alert on right now.</div>
        ) : (
          <div className={s.statusList}>
            {alerts.map((a) => (
              <div key={a.id} className={s.statusItem}>
                <StatusIcon level={a.severity === "critical" ? "bad" : "warn"} />
                <div>
                  <div className={s.statusName}>{a.title}</div>
                  <div className={s.statusDetail}>{a.detail}</div>
                  {a.fix && <div className={s.statusDetail} style={{ marginTop: 4 }}><strong>What to do:</strong> {a.fix}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div style={{ height: 12 }} />

      <div className={s.grid2}>
        <Card title="Checks">
          <div className={s.statusList}>
            {checks.map((c) => (
              <div key={c.id} className={s.statusItem}>
                <StatusIcon level={c.level} />
                <div>
                  <div className={s.statusName}>{c.name}</div>
                  <div className={s.statusDetail}>{c.detail}</div>
                  {c.fix && c.level !== "ok" && <div className={s.statusDetail} style={{ marginTop: 4 }}><strong>Fix:</strong> {c.fix}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Events received" sub="Per hour, last 48 hours (UTC)">
          {hours.length === 0 ? (
            <div className={s.empty}>No events in the last 48 hours.</div>
          ) : (
            <>
              <Columns
                label="Events per hour"
                labels={hours.map((h) => hourLabel(h.hour))}
                labelEvery={8}
                kind="number"
                height={240}
                series={[
                  { name: "Storefront visits", color: "var(--s1)", values: hours.map((h) => h.tracker) },
                  { name: "Checkout events", color: "var(--s2)", values: hours.map((h) => h.pixel) },
                ]}
              />
              <TableToggle>
                <DataTable
                  nameLabel="Hour (UTC)"
                  defaultSort="name"
                  columns={[
                    { key: "tracker", label: "Visits" },
                    { key: "pixel", label: "Checkout events" },
                  ]}
                  rows={hours.map((h) => ({ id: h.hour, name: h.hour.slice(0, 13).replace("T", " ") + ":00", values: { tracker: h.tracker, pixel: h.pixel } }))}
                />
              </TableToggle>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

import Link from "next/link";
import { currentMode } from "@/lib/dashboard/data";
import { liveSummary, locationLabel, STAGE_LABELS, type LiveSession } from "@/lib/live";
import { loadLiveEvents } from "@/lib/live-data";
import s from "../dashboard.module.css";
import { AutoRefresh } from "../_components/AutoRefresh";
import { Card, PageHead } from "../_components/ui";

export const dynamic = "force-dynamic";

const nowMs = () => Date.now();

function flag(country: string | null): string {
  if (!country || !/^[A-Z]{2}$/.test(country)) return "🌐";
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function ago(iso: string, now: number): string {
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`;
}

function duration(from: string, to: string): string {
  const sec = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

const DEVICE_ICON: Record<string, string> = { mobile: "📱", tablet: "📲", desktop: "💻" };

function TopList({ title, items, empty }: { title: string; items: { label: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <Card title={title}>
      {items.length === 0 ? (
        <div className={s.muted} style={{ fontSize: 12.5 }}>{empty}</div>
      ) : (
        <ul className={s.liveTop}>
          {items.map((i) => (
            <li key={i.label}>
              <span className={s.liveTopLabel} title={i.label}>{i.label}</span>
              <span className={s.liveTopBar}><span style={{ width: `${(i.count / max) * 100}%` }} /></span>
              <b>{i.count}</b>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Visitor({ v, now, mode }: { v: LiveSession; now: number; mode: "live" | "demo" }) {
  const stageClass = v.checkout === "purchased" ? s.goodText : v.checkout !== "none" ? s.warnText : s.muted;
  return (
    <details className={`${s.liveRow} ${v.active ? "" : s.liveRowIdle}`}>
      <summary>
        <span className={s.liveWho}>
          <span className={s.liveFlag} aria-hidden="true">{flag(v.location.country)}</span>
          <span style={{ minWidth: 0 }}>
            <span className={s.liveLoc}>{locationLabel(v.location)}</span>
            <span className={s.liveMeta}>
              {v.device ? `${DEVICE_ICON[v.device] ?? ""} ${v.device}` : "unknown device"} · {v.pageViews} page{v.pageViews === 1 ? "" : "s"} · on site {duration(v.startedAt, v.lastSeenAt)}
            </span>
          </span>
        </span>
        <span className={s.liveSource}>
          <span className={s.chip}>{v.sourceLabel}</span>
          {v.campaign && <span className={s.liveMeta}>{v.campaign}</span>}
        </span>
        <span className={s.liveNow}>
          <span className={s.liveLoc}>{v.currentTitle || v.currentPath || "—"}</span>
          <span className={`${s.liveMeta} ${stageClass}`}>{STAGE_LABELS[v.checkout]}</span>
        </span>
        <span className={s.liveWhen}>
          {v.active && <span className={s.liveDot} aria-label="Active now" />}
          {ago(v.lastSeenAt, now)}
        </span>
      </summary>
      <div className={s.liveTrail}>
        <div className={s.findingsTitle}>Activity (newest first)</div>
        <ol>
          {v.activity.map((a, i) => (
            <li key={`${a.at}-${i}`}>
              <span className={s.muted}>{new Date(a.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
              <span className={a.kind === "checkout" ? s.warnText : undefined}>{a.label}</span>
              {a.kind === "page" && a.path && a.label !== a.path && <span className={s.muted}>{a.path}</span>}
            </li>
          ))}
        </ol>
        <div className={s.liveMeta} style={{ marginTop: 8 }}>
          Landed on {v.landingPath ?? "—"} · first seen {ago(v.startedAt, now)}
          {mode === "live" && (
            <>
              {" · "}
              <Link href={`/debug/visitors/${v.visitorId}`}>Full journey ›</Link>
            </>
          )}
        </div>
      </div>
    </details>
  );
}

export default async function LivePage() {
  const mode = await currentMode();
  const now = nowMs();
  const events = await loadLiveEvents(mode, now);
  const live = liveSummary(events, now);
  const active = live.sessions.filter((x) => x.active);
  const recent = live.sessions.filter((x) => !x.active).slice(0, 30);

  return (
    <>
      <PageHead title="Live" subtitle="Who's on your store right now, where they came from and what they're doing" mode={mode} action={<AutoRefresh seconds={10} />} exportable={false} />

      <div className={s.liveHero}>
        <div>
          <div className={s.heroLabel}>On your store now</div>
          <div className={s.heroValue}>
            {live.activeNow} <span className={s.liveHeroUnit}>visitor{live.activeNow === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className={s.liveHeroStats}>
          <div><b>{live.inCheckout}</b><span>in checkout</span></div>
          <div><b>{live.purchases}</b><span>purchases · 30 min</span></div>
          <div><b>{live.sessions.length}</b><span>visits · 30 min</span></div>
        </div>
      </div>

      <div className={s.grid3}>
        <TopList title="Where they are" items={live.topLocations} empty="No one on the site right now." />
        <TopList title="Where they came from" items={live.topSources} empty="—" />
        <TopList title="What they're viewing" items={live.topPages} empty="—" />
      </div>

      <Card title={`Active now (${active.length})`} sub="Seen in the last 5 minutes. Click a visitor to see their path.">
        {active.length === 0 ? (
          <div className={s.empty}>
            {mode === "live" ? "No visitors in the last 5 minutes. This updates every 10 seconds." : "No demo visitors right now."}
          </div>
        ) : (
          <div className={s.liveList}>{active.map((v) => <Visitor key={v.key} v={v} now={now} mode={mode} />)}</div>
        )}
      </Card>

      {recent.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Card title="Recently left" sub="Last 30 minutes">
            <div className={s.liveList}>{recent.map((v) => <Visitor key={v.key} v={v} now={now} mode={mode} />)}</div>
          </Card>
        </div>
      )}
    </>
  );
}

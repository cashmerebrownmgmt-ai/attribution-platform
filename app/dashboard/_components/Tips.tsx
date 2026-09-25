import type { Tip } from "@/lib/behavior-insights";
import s from "../dashboard.module.css";

const AREA_LABELS: Record<Tip["area"], string> = {
  mobile: "Mobile",
  landing: "Landing page",
  cart: "Cart",
  checkout: "Checkout",
  channels: "Traffic sources",
  audience: "Audience",
  geo: "Location",
  timing: "Timing",
  trend: "Trend",
};

/** Behavior-based tips, ranked by estimated extra orders. The first few open by default. */
export function Tips({ tips, open = 3 }: { tips: Tip[]; open?: number }) {
  if (tips.length === 0) {
    return <div className={s.empty}>No clear patterns yet. Tips appear once there are a few hundred sessions to learn from.</div>;
  }
  return (
    <div className={s.tips}>
      {tips.map((t, i) => (
        <details key={t.id} className={s.tip} open={i < open}>
          <summary>
            <span className={s.tipArea}>{AREA_LABELS[t.area]}</span>
            <span className={s.tipTitle}>{t.title}</span>
            {t.impact >= 0.5 && <span className={s.tipImpact}>≈ +{Math.round(t.impact)} orders / 30 days</span>}
          </summary>
          <p className={s.tipWhy}>{t.why}</p>
          <ol className={s.tipActions}>
            {t.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
          <div className={s.cardSub}>Based on: {t.evidence}.{t.tested ? " The gap is statistically significant." : ""}</div>
        </details>
      ))}
    </div>
  );
}

"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import s from "../../dashboard.module.css";
import { HoverPreview } from "../HoverPreview";
import { fmt, type ValueKind } from "./fmt";

export type BarItem = { key: string; label: string; value: number | null; color?: string; note?: string; href?: string; preview?: ReactNode };

type Props = {
  items: BarItem[];
  kind: ValueKind;
  currency?: string;
  /** Draw a dashed marker at this value (e.g. target ROAS). */
  target?: { value: number; label: string };
  label: string;
};

/** Horizontal bars with the value at the tip. Values are always labeled, so no tooltip is needed. */
export function BarList({ items, kind, currency = "USD", target, label }: Props) {
  const max = Math.max(0, ...items.map((i) => i.value ?? 0), target?.value ?? 0) || 1;
  return (
    <div role="list" aria-label={label}>
      {items.map((item, idx) => {
        const w = Math.max(0, ((item.value ?? 0) / max) * 100);
        return (
          <div key={item.key} role="listitem" className={s.barRow} title={item.note ? `${item.label}: ${item.note}` : undefined}>
            <span className={s.barLabel}>
              {item.color && <span className={s.swatch} style={{ background: item.color }} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                <BarName item={item} />
                {item.note && <span className={s.barNote}>{item.note}</span>}
              </span>
            </span>
            <span className={s.barTrack}>
              <span
                className={`${s.barFill} ${s.growX}`}
                style={{
                  display: "block",
                  width: `${w}%`,
                  maxHeight: 24,
                  background: item.color ?? "var(--s1)",
                  animationDelay: `${idx * 0.04}s`,
                }}
              />
              {target && <span className={s.targetMark} style={{ left: `${(target.value / max) * 100}%` }} title={target.label} />}
            </span>
            <span className={s.barValue}>{fmt(kind, item.value, currency, true)}</span>
          </div>
        );
      })}
      {target && (
        <div className={s.cardSub} style={{ marginTop: 6 }}>
          Dashed line: {target.label}
        </div>
      )}
    </div>
  );
}

function BarName({ item }: { item: BarItem }) {
  const name = item.href ? (
    <Link href={item.href} scroll={false} className={s.inspectLink}>
      {item.label}
    </Link>
  ) : (
    <>{item.label}</>
  );
  return item.preview ? <HoverPreview content={item.preview}>{name}</HoverPreview> : name;
}

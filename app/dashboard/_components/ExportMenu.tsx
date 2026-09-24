"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import s from "../dashboard.module.css";

const CSV_VIEWS: [string, string][] = [
  ["daily", "Daily performance"],
  ["channels", "Channels"],
  ["platforms", "Ad platforms"],
  ["campaigns", "Campaigns"],
  ["ads", "Ads"],
  ["orders", "Orders"],
];

// Only the filters travel to exports; page-specific params (drill-down, open ad) don't.
const CARRY = ["range", "from", "to", "model", "platform"];

/** Download menu: PDF report and CSVs, scoped to the current filters. */
export function ExportMenu() {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const q = new URLSearchParams();
  for (const k of CARRY) {
    const v = params.get(k);
    if (v) q.set(k, v);
  }
  const withView = (extra: Record<string, string>) => {
    const p = new URLSearchParams(q);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p.toString();
  };

  return (
    <div className={s.picker} ref={root}>
      <button type="button" className={s.button} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        Export
      </button>
      {open && (
        <div className={s.pickerPanel} role="menu" style={{ left: "auto", right: 0, width: 230 }}>
          <a role="menuitem" className={s.pickerRow} href={`/dashboard/report?${withView({ download: "1" })}`} onClick={() => setOpen(false)}>
            <span className={s.pickerCheck} aria-hidden="true">⤓</span>
            <span>
              PDF report
              <span className={s.barNote}>KPIs, charts, actions, health</span>
            </span>
          </a>
          <div className={s.menuLabel}>CSV</div>
          {CSV_VIEWS.map(([view, label]) => (
            <a key={view} role="menuitem" className={s.pickerRow} href={`/dashboard/export?${withView({ view })}`} onClick={() => setOpen(false)}>
              <span className={s.pickerCheck} aria-hidden="true" />
              {label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

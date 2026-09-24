"use client";
import { useEffect, useRef, useState } from "react";
import s from "../dashboard.module.css";

type Props = {
  preset: string;
  from: string;
  to: string;
  label: string;
  presets: { value: string; label: string }[];
  today: string;
  onPreset: (id: string) => void;
  onCustom: (from: string, to: string) => void;
};

/** Date range control: preset rows first, custom range behind a hairline in the footer. */
export function DateRangePicker({ preset, from, to, label, presets, today, onPreset, onCustom }: Props) {
  const [open, setOpen] = useState(false);
  const [cFrom, setFrom] = useState(from);
  const [cTo, setTo] = useState(to);
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

  const current = presets.find((p) => p.value === preset)?.label ?? "Custom";

  return (
    <div className={s.picker} ref={root}>
      <button
        type="button"
        className={s.select}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setFrom(from);
          setTo(to);
          setOpen((o) => !o);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ marginRight: 6, verticalAlign: -2 }}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        {current}
        <span className={s.muted} style={{ marginLeft: 8, fontWeight: 400 }}>
          {label}
        </span>
      </button>
      {open && (
        <div className={s.pickerPanel} role="dialog" aria-label="Choose date range">
          <ul className={s.pickerList}>
            {presets.map((p) => (
              <li key={p.value}>
                <button
                  type="button"
                  className={s.pickerRow}
                  aria-pressed={p.value === preset}
                  onClick={() => {
                    setOpen(false);
                    onPreset(p.value);
                  }}
                >
                  <span className={s.pickerCheck} aria-hidden="true">{p.value === preset ? "✓" : ""}</span>
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
          <form
            className={s.pickerCustom}
            onSubmit={(e) => {
              e.preventDefault();
              if (cFrom && cTo && cFrom <= cTo) {
                setOpen(false);
                onCustom(cFrom, cTo);
              }
            }}
          >
            <div className={s.pickerDates}>
              <label>
                <span>From</span>
                <input type="date" value={cFrom} max={cTo || today} onChange={(e) => setFrom(e.target.value)} required />
              </label>
              <label>
                <span>To</span>
                <input type="date" value={cTo} min={cFrom} max={today} onChange={(e) => setTo(e.target.value)} required />
              </label>
            </div>
            <button type="submit" className={`${s.button} ${s.buttonPrimary}`} disabled={!cFrom || !cTo || cFrom > cTo}>
              Apply custom range
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

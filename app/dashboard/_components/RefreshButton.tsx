"use client";
import { useRouter } from "next/navigation";
import { formatStoreTime } from "@/lib/tz";
import { useState, useTransition } from "react";
import { refreshData, type RefreshResult } from "../refresh-action";
import s from "../dashboard.module.css";

const NOTES: Record<RefreshResult["meta"], string> = {
  synced: "Shopify and Meta up to date",
  recent: "Up to date (Meta pulled in the last minute)",
  not_connected: "Shopify up to date",
  failed: "Shopify up to date · Meta sync failed",
  demo: "Demo data refreshed",
};

/** Re-reads everything (and pulls the latest Meta numbers) with one click. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RefreshResult | null>(null);

  const click = () =>
    start(async () => {
      const r = await refreshData();
      setResult(r);
      router.refresh();
    });

  // Store time, not the device's, so it matches every other time on the dashboard.
  const time = result ? `${formatStoreTime(result.at, { hour: "numeric", minute: "2-digit" })} ET` : null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {result && !pending && (
        <span className={result.meta === "failed" ? s.badText : s.muted} style={{ fontSize: 12 }} title={result.message} role="status">
          {NOTES[result.meta]} · {time}
        </span>
      )}
      <button type="button" className={`${s.button} ${s.buttonGhost}`} onClick={click} disabled={pending} aria-label="Refresh data">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={pending ? { animation: "spin 0.9s linear infinite" } : undefined}>
          <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
        </svg>
        {pending ? "Refreshing…" : "Refresh"}
      </button>
    </span>
  );
}

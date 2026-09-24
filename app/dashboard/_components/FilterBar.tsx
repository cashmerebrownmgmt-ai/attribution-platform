"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import s from "../dashboard.module.css";

type Option = { value: string; label: string };

type Props = {
  preset: string;
  model: string;
  platform: string;
  rangeText: string;
  presets: Option[];
  models: Option[];
  platforms: Option[];
  showPlatform?: boolean;
};

/** One row of filters above the page. Changes go into the URL so views are shareable. */
export function FilterBar({ preset, model, platform, rangeText, presets, models, platforms, showPlatform = true }: Props) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const set = (key: string, value: string, defaults: string) => {
    const q = new URLSearchParams(params.toString());
    if (key === "range") {
      q.delete("from");
      q.delete("to");
    }
    if (value === defaults) q.delete(key);
    else q.set(key, value);
    start(() => router.replace(`${path}${q.toString() ? `?${q}` : ""}`, { scroll: false }));
  };

  return (
    <div className={`${s.filters} ${pending ? s.filtersBusy : ""}`} role="group" aria-label="Filters" aria-busy={pending}>
      <select className={s.select} aria-label="Date range" value={preset === "custom" ? "" : preset} onChange={(e) => set("range", e.target.value, "30d")}>
        {preset === "custom" && <option value="">Custom range</option>}
        {presets.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <select className={s.select} aria-label="Attribution model" value={model} onChange={(e) => set("model", e.target.value, "last_non_direct")}>
        {models.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {showPlatform && (
        <select className={s.select} aria-label="Platform" value={platform} onChange={(e) => set("platform", e.target.value, "all")}>
          {platforms.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      <span className={s.rangeLabel}>{rangeText}</span>
    </div>
  );
}

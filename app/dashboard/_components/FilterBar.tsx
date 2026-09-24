"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import s from "../dashboard.module.css";
import { DateRangePicker } from "./DateRangePicker";

type Option = { value: string; label: string };

type Props = {
  preset: string;
  from: string;
  to: string;
  today: string;
  model: string;
  platform: string;
  rangeText: string;
  presets: Option[];
  models: Option[];
  platforms: Option[];
  showPlatform?: boolean;
};

/** One row of filters above the page. Changes go into the URL so views are shareable. */
export function FilterBar({ preset, from, to, today, model, platform, rangeText, presets, models, platforms, showPlatform = true }: Props) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const go = (mutate: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(params.toString());
    mutate(q);
    start(() => router.replace(`${path}${q.toString() ? `?${q}` : ""}`, { scroll: false }));
  };
  const set = (key: string, value: string, fallback: string) =>
    go((q) => (value === fallback ? q.delete(key) : q.set(key, value)));

  return (
    <div className={`${s.filters} ${pending ? s.filtersBusy : ""}`} role="group" aria-label="Filters" aria-busy={pending}>
      <DateRangePicker
        preset={preset}
        from={from}
        to={to}
        today={today}
        label={rangeText}
        presets={presets}
        onPreset={(id) =>
          go((q) => {
            q.delete("from");
            q.delete("to");
            if (id === "30d") q.delete("range");
            else q.set("range", id);
          })
        }
        onCustom={(f, t) =>
          go((q) => {
            q.delete("range");
            q.set("from", f);
            q.set("to", t);
          })
        }
      />
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
    </div>
  );
}

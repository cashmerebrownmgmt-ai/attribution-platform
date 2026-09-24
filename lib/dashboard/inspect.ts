/** `?inspect=` targets for the breakdown drawer: "platform:google", "campaign:meta:123", "ad:meta:456". Pure. */
import type { Level } from "../metrics/compute";
import { filterQuery, type ParsedFilters } from "./filters";

const LEVELS: Level[] = ["platform", "campaign", "adGroup", "ad"];
const PLATFORMS = ["meta", "google", "tiktok", "microsoft"];

export type InspectTarget = { level: Level; key: string };

export function parseInspect(v: string | string[] | undefined): InspectTarget | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  const [level, ...rest] = s.split(":");
  const key = rest.join(":");
  if (!LEVELS.includes(level as Level) || !key || key.length > 200) return null;
  const platform = key.split(":")[0];
  if (!PLATFORMS.includes(platform)) return null;
  if (level === "platform" ? key.includes(":") : !/^[a-z]+:[^:]+$/.test(key)) return null;
  return { level: level as Level, key };
}

export const inspectValue = (level: Level, key: string) => `${level}:${key}`;

/** Link to the current page with the drawer open on this entity (other params kept). */
export function inspectHref(path: string, f: ParsedFilters, level: Level, key: string, keep: Record<string, string | null> = {}): string {
  return `${path}${filterQuery(f, { ...keep, inspect: inspectValue(level, key) })}`;
}

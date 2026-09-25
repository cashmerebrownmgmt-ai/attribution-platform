/**
 * Pure tracker logic: no globals, so it can be unit-tested and bundled into t.js.
 * See docs/phase-1-spec.md §3.
 */
import { CLICK_ID_KEYS, UTM_KEYS } from "../lib/source";

export const VISITOR_COOKIE = "_ap_vid";
export const CART_ATTRIBUTE = "_ap_vid";
export const SESSION_KEY = "_ap_s";
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const COOKIE_MAX_AGE_S = 395 * 24 * 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type Session = { id: string; t: number; k: string };

export function uuid(crypto: Crypto): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

export function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Domains to try for the visitor cookie, broadest first, e.g. shop.example.com ->
 * ["example.com", "shop.example.com"]. The browser refuses public suffixes like "co.uk",
 * so the caller keeps the first one that sticks.
 */
export function cookieDomainCandidates(hostname: string): string[] {
  if (!hostname.includes(".") || /^[\d.]+$/.test(hostname)) return [hostname]; // localhost / IP
  const labels = hostname.split(".");
  const out: string[] = [];
  for (let n = 2; n <= labels.length; n++) out.push(labels.slice(-n).join("."));
  return out;
}

export function visitorCookie(id: string, domain: string, secure: boolean): string {
  const parts = [`${VISITOR_COOKIE}=${id}`, "path=/", `max-age=${COOKIE_MAX_AGE_S}`, "SameSite=Lax"];
  if (domain.includes(".")) parts.push(`domain=${domain}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** The marketing params on this URL, as a stable key. Empty string when there are none. */
export function sourceKey(url: string): string {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return "";
  }
  return [...UTM_KEYS, ...CLICK_ID_KEYS]
    .map((k) => {
      const v = params.get(k)?.trim();
      return v ? `${k}=${v}` : "";
    })
    .filter(Boolean)
    .join("&");
}

/** Keep the session unless it's missing, idle for 30+ minutes, or this page brings a new marketing source. */
export function nextSession(prev: Session | null, now: number, key: string, newId: () => string): Session {
  const expired = !prev || now - prev.t > SESSION_IDLE_MS;
  const newSource = key !== "" && prev !== null && key !== prev.k;
  if (expired || newSource) return { id: newId(), t: now, k: key };
  return { id: prev.id, t: now, k: prev.k };
}

export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<Session>;
    return isUuid(s.id) && typeof s.t === "number" && typeof s.k === "string" ? (s as Session) : null;
  } catch {
    return null;
  }
}

export type CartSnapshot = { item_count?: number; attributes?: Record<string, unknown> | null };

/**
 * Whether to tag the cart with the visitor ID: only when it has items and isn't tagged with this
 * visitor yet. (Stores don't reliably expose the cart cookie to scripts, so we read /cart.js.)
 */
export function cartNeedsTag(cart: CartSnapshot | null, visitorId: string): boolean {
  return !!cart && (cart.item_count ?? 0) > 0 && cart.attributes?.[CART_ATTRIBUTE] !== visitorId;
}

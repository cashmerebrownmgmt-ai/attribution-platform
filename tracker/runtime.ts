/** Browser pieces shared by the storefront script (t.js) and the landing-page script (lp.js). */
import { ADD_TO_CART_KEY, SESSION_KEY, VISITOR_COOKIE, cookieDomainCandidates, isUuid, nextSession, parseSession, readCookie, sourceKey, uuid, visitorCookie } from "./core";

type CustomerPrivacy = { analyticsProcessingAllowed?: () => boolean };
type ShopifyGlobal = {
  customerPrivacy?: CustomerPrivacy;
  loadFeatures?: (features: { name: string; version: string }[], cb: (err?: unknown) => void) => void;
  routes?: { root?: string };
};
export type TrackerWindow = Window & typeof globalThis & { Shopify?: ShopifyGlobal; __apTracker?: boolean };

export type Ctx = { w: TrackerWindow; endpoint: string; visitorId: string; sessionId: string };

export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Read the visitor ID, or create one and store it on the broadest domain the browser accepts.
 * A valid ID handed over from a landing page (`preferred`) takes over, so the visit continues.
 */
export function ensureVisitorId(w: TrackerWindow, preferred: string | null = null): string {
  const doc = w.document;
  const existing = readCookie(doc.cookie, VISITOR_COOKIE);
  const id = preferred ?? (isUuid(existing) ? existing : uuid(w.crypto));
  const secure = w.location.protocol === "https:";
  for (const domain of cookieDomainCandidates(w.location.hostname)) {
    doc.cookie = visitorCookie(id, domain, secure); // refresh expiry on every visit
    if (readCookie(doc.cookie, VISITOR_COOKIE) === id) break;
  }
  return id;
}

export function send(w: TrackerWindow, endpoint: string, body: object): void {
  const json = JSON.stringify(body);
  // sendBeacon posts text/plain, which avoids a CORS preflight and survives page unloads.
  if (w.navigator.sendBeacon?.(endpoint, json)) return;
  void w.fetch(endpoint, { method: "POST", body: json, keepalive: true, mode: "cors", credentials: "omit" }).catch(() => {});
}

const title = (w: TrackerWindow) => (w.document.title ? w.document.title.slice(0, 300) : null);

/** Start or continue the session and send the page view. */
export function pageView(w: TrackerWindow, endpoint: string, preferredVisitor: string | null = null): Ctx {
  const now = Date.now();
  const url = w.location.href;
  const visitorId = ensureVisitorId(w, preferredVisitor);
  const prev = safe(() => parseSession(w.sessionStorage.getItem(SESSION_KEY)), null);
  const session = nextSession(prev, now, sourceKey(url), () => uuid(w.crypto));
  safe(() => w.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)), undefined);
  send(w, endpoint, { id: uuid(w.crypto), visitor_id: visitorId, session_id: session.id, type: "page_view", source: "tracker", occurred_at: now, url, referrer: w.document.referrer || null, title: title(w) });
  return { w, endpoint, visitorId, sessionId: session.id };
}

/** One add_to_cart event per session. */
export function reportAddToCart(c: Ctx): void {
  const done = safe(() => c.w.sessionStorage.getItem(ADD_TO_CART_KEY), null);
  if (done === c.sessionId) return;
  safe(() => c.w.sessionStorage.setItem(ADD_TO_CART_KEY, c.sessionId), undefined);
  send(c.w, c.endpoint, { id: uuid(c.w.crypto), visitor_id: c.visitorId, session_id: c.sessionId, type: "add_to_cart", source: "tracker", occurred_at: Date.now(), url: c.w.location.href, referrer: null, title: title(c.w) });
}

/** Collect endpoint next to wherever the script was loaded from. */
export const endpointFor = (scriptSrc: string) => new URL("/api/collect", scriptSrc).href;

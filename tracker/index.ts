/**
 * Storefront tracking script, bundled to public/t.js and loaded in the theme with:
 *   <script src="https://<app-domain>/t.js" async></script>
 * Events go to /api/collect on the same origin the script was loaded from.
 */
import {
  ADD_TO_CART_KEY,
  CART_ATTRIBUTE,
  CART_COUNT_KEY,
  cartCountIncreased,
  isAddToCartAction,
  SESSION_KEY,
  VISITOR_COOKIE,
  cartNeedsTag,
  cookieDomainCandidates,
  isUuid,
  nextSession,
  parseSession,
  readCookie,
  sourceKey,
  uuid,
  visitorCookie,
} from "./core";

type CustomerPrivacy = { analyticsProcessingAllowed?: () => boolean };
type ShopifyGlobal = {
  customerPrivacy?: CustomerPrivacy;
  loadFeatures?: (features: { name: string; version: string }[], cb: (err?: unknown) => void) => void;
  routes?: { root?: string };
};
type TrackerWindow = Window & typeof globalThis & { Shopify?: ShopifyGlobal; __apTracker?: boolean };

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Read the visitor ID, or create one and store it on the broadest domain the browser accepts. */
function ensureVisitorId(w: TrackerWindow): string {
  const doc = w.document;
  const existing = readCookie(doc.cookie, VISITOR_COOKIE);
  const id = isUuid(existing) ? existing : uuid(w.crypto);
  const secure = w.location.protocol === "https:";
  for (const domain of cookieDomainCandidates(w.location.hostname)) {
    doc.cookie = visitorCookie(id, domain, secure); // refresh expiry on every visit
    if (readCookie(doc.cookie, VISITOR_COOKIE) === id) break;
  }
  return id;
}

function send(w: TrackerWindow, endpoint: string, body: object): void {
  const json = JSON.stringify(body);
  // sendBeacon posts text/plain, which avoids a CORS preflight and survives page unloads.
  if (w.navigator.sendBeacon?.(endpoint, json)) return;
  void w.fetch(endpoint, { method: "POST", body: json, keepalive: true, mode: "cors", credentials: "omit" }).catch(() => {});
}

type Ctx = { w: TrackerWindow; endpoint: string; visitorId: string; sessionId: string };

/** One add_to_cart event per session. */
function reportAddToCart(c: Ctx): void {
  const done = safe(() => c.w.sessionStorage.getItem(ADD_TO_CART_KEY), null);
  if (done === c.sessionId) return;
  safe(() => c.w.sessionStorage.setItem(ADD_TO_CART_KEY, c.sessionId), undefined);
  send(c.w, c.endpoint, {
    id: uuid(c.w.crypto),
    visitor_id: c.visitorId,
    session_id: c.sessionId,
    type: "add_to_cart",
    source: "tracker",
    occurred_at: Date.now(),
    url: c.w.location.href,
    referrer: null,
    title: c.w.document.title ? c.w.document.title.slice(0, 300) : null,
  });
}

/**
 * Put the visitor ID on the cart so Shopify copies it onto the order's note_attributes, and notice
 * cart additions made since the last page view. Checked on every page view (one small /cart.js
 * read); only writes when the cart has items and isn't tagged. Shopify merges attributes, so other
 * apps' cart attributes are kept.
 */
async function syncCart(c: Ctx): Promise<void> {
  const { w, visitorId } = c;
  const root = w.Shopify?.routes?.root ?? "/"; // non-default for multi-language stores, e.g. "/en-ca/"
  const res = await w.fetch(`${root}cart.js`, { credentials: "same-origin" });
  if (!res.ok) return;
  const cart = (await res.json()) as { item_count?: number; attributes?: Record<string, unknown> };
  const count = cart.item_count ?? 0;
  const previous = safe(() => w.sessionStorage.getItem(CART_COUNT_KEY), null);
  if (cartCountIncreased(previous, count)) reportAddToCart(c);
  safe(() => w.sessionStorage.setItem(CART_COUNT_KEY, String(count)), undefined);
  if (!cartNeedsTag(cart, visitorId)) return;
  await w.fetch(`${root}cart/update.js`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attributes: { [CART_ATTRIBUTE]: visitorId } }),
  });
}

export function track(w: TrackerWindow, endpoint: string): void {
  const now = Date.now();
  const url = w.location.href;
  const visitorId = ensureVisitorId(w);
  const prev = safe(() => parseSession(w.sessionStorage.getItem(SESSION_KEY)), null);
  const session = nextSession(prev, now, sourceKey(url), () => uuid(w.crypto));
  safe(() => w.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)), undefined);

  send(w, endpoint, {
    id: uuid(w.crypto),
    visitor_id: visitorId,
    session_id: session.id,
    type: "page_view",
    source: "tracker",
    occurred_at: now,
    url,
    referrer: w.document.referrer || null,
    title: w.document.title ? w.document.title.slice(0, 300) : null,
  });

  const ctx: Ctx = { w, endpoint, visitorId, sessionId: session.id };
  // Classic product forms post to /cart/add; catch them as they're submitted.
  w.document.addEventListener(
    "submit",
    (e) => {
      const form = e.target as HTMLFormElement | null;
      if (form && isAddToCartAction(form.getAttribute("action"))) safe(() => reportAddToCart(ctx), undefined);
    },
    true,
  );
  void syncCart(ctx).catch(() => {});
}

/**
 * Track only once analytics consent allows it. Themes without Shopify's consent API are
 * tracked immediately; otherwise wait for the visitor's choice.
 */
export function init(w: TrackerWindow, scriptSrc: string | null): void {
  if (w.__apTracker || !scriptSrc) return;
  w.__apTracker = true;
  const endpoint = new URL("/api/collect", scriptSrc).href;

  let started = false;
  const start = () => {
    if (started) return;
    const privacy = w.Shopify?.customerPrivacy;
    if (privacy?.analyticsProcessingAllowed && !privacy.analyticsProcessingAllowed()) return;
    started = true;
    track(w, endpoint);
  };

  w.document.addEventListener("visitorConsentCollected", () => safe(start, undefined));

  const shopify = w.Shopify;
  if (shopify?.loadFeatures && !shopify.customerPrivacy) {
    shopify.loadFeatures([{ name: "consent-tracking-api", version: "0.1" }], () => safe(start, undefined));
  } else {
    start();
  }
}

// Browser entry point. Never let an error escape into the storefront.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  try {
    const script = document.currentScript as HTMLScriptElement | null;
    init(window as TrackerWindow, script?.src ?? null);
  } catch {
    // swallow
  }
}

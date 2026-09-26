/**
 * Storefront tracking script, bundled to public/t.js and loaded in the Shopify theme with:
 *   <script src="https://<app-domain>/t.js" async></script>
 * (Landing pages on other domains use lp.js instead; see tracker/landing.ts.)
 * Events go to /api/collect on the same origin the script was loaded from.
 */
import { CART_ATTRIBUTE, CART_COUNT_KEY, cartCountIncreased, cartNeedsTag, isAddToCartAction, visitorFromUrl } from "./core";
import { endpointFor, pageView, reportAddToCart, safe, type Ctx, type TrackerWindow } from "./runtime";

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
  // A visitor handed over from a landing page (?_ap_vid=…) continues that visit here.
  const ctx = pageView(w, endpoint, visitorFromUrl(w.location.href));
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
  const endpoint = endpointFor(scriptSrc);

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

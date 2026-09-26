/**
 * Landing-page tracking script, bundled to public/lp.js, for pages hosted off the store (e.g. Lovable):
 *   <script src="https://<app-domain>/lp.js" data-store="cashmerebrown.com" async></script>
 * Records the visit (with its UTMs and click IDs), and makes every link or window.open to the
 * store carry the visitor ID and the session's ad params, so the order matches this visit.
 */
import { CARRY_KEY, decorateStoreUrl, isCartPermalink, isEditorPreview, isStoreUrl, marketingParams, parseStoreHosts } from "./core";
import { endpointFor, pageView, reportAddToCart, safe, type Ctx, type TrackerWindow } from "./runtime";

function linkToStore(c: Ctx, storeHosts: string[]): void {
  const { w } = c;
  const here = marketingParams(w.location.href);
  const saved = safe(() => JSON.parse(w.sessionStorage.getItem(CARRY_KEY) ?? "{}") as Record<string, string>, {});
  // A new ad click replaces what the session came in with; otherwise keep the original source.
  const carry = Object.keys(here).length ? here : saved;
  safe(() => w.sessionStorage.setItem(CARRY_KEY, JSON.stringify(carry)), undefined);

  const decorate = (url: string): string => {
    if (!isStoreUrl(url, storeHosts, w.location.href)) return url;
    const out = decorateStoreUrl(url, c.visitorId, carry, w.location.href);
    // A cart permalink goes straight to checkout: count the click as adding to cart.
    if (isCartPermalink(out)) safe(() => reportAddToCart(c), undefined);
    return out;
  };

  // Rewrite links as they're clicked (capture phase, before the browser follows them).
  const onClick = (e: Event) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    const next = decorate(href);
    if (next !== href) a.setAttribute("href", next);
  };
  w.document.addEventListener("click", onClick, true);
  w.document.addEventListener("auxclick", onClick, true);

  // Buttons that open the store in a new tab.
  const open = w.open.bind(w);
  w.open = ((url?: string | URL, target?: string, features?: string) => open(url === undefined ? url : decorate(String(url)), target, features)) as typeof w.open;
}

export function trackLanding(w: TrackerWindow, endpoint: string, storeHosts: string[]): void {
  const ctx = pageView(w, endpoint);
  if (storeHosts.length && !isStoreUrl(w.location.href, storeHosts)) linkToStore(ctx, storeHosts);
}

// Browser entry point. Never let an error escape into the page.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  try {
    const w = window as TrackerWindow;
    const script = document.currentScript as HTMLScriptElement | null;
    // Skip Lovable's editor previews: they're you editing the page, not visitors.
    if (!w.__apTracker && script?.src && !isEditorPreview(w.location.hostname)) {
      w.__apTracker = true;
      trackLanding(w, endpointFor(script.src), parseStoreHosts(script.getAttribute("data-store")));
    }
  } catch {
    // swallow
  }
}

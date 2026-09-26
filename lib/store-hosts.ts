/**
 * The store's own hostnames (the Shopify storefront). Anything else a tracked visitor is on, e.g.
 * lowendbundle.cashmerebrown.com or a *.lovable.app page, is an off-store landing page.
 * Override with STORE_HOSTS (comma-separated) if the store's domain changes.
 */
export const STORE_HOSTS: string[] = (process.env.STORE_HOSTS ?? "cashmerebrown.com,cashmerebrown-com.myshopify.com")
  .split(",")
  .map((h) => h.trim().toLowerCase().replace(/^www\./, ""))
  .filter(Boolean);

export function siteOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export const isLandingSite = (site: string | null, storeHosts: string[] = STORE_HOSTS) => !!site && !storeHosts.includes(site);

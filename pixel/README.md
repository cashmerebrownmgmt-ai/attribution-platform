# Checkout pixel

Shopify runs checkout in its own sandbox, so the storefront tracking script can't see it. This custom pixel reports checkout steps (with the checkout token and, at the end, the order ID) to `/api/collect`, reusing the storefront's `_ap_vid` visitor cookie. That's what links orders to visitors when the cart attribute is missing.

## Install
1. Shopify admin → **Settings → Customer events → Add custom pixel**, name it `Attribution`.
2. **Customer privacy:** Permission *Required*, Analytics. **Data sale:** *Data collected does not qualify as data sale.*
3. Paste the contents of `custom-pixel.js`, **Save**, then **Connect**.

If the app moves to a new domain, update `ENDPOINT` at the top of the file and re-paste it.

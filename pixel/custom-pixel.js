// Attribution platform: checkout pixel.
// Paste into Shopify admin → Settings → Customer events → Add custom pixel.
// Permission: "Not required" is fine; set Data sale to "Data collected does not qualify as data sale".
// Customer privacy: choose "Analytics" so Shopify only runs it when the visitor allows analytics.

const ENDPOINT = "https://attribution-platform-sigma.vercel.app/api/collect";
const COOKIE = "_ap_vid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function uuid() {
  if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID();
  const b = self.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Landing pages (e.g. Lovable) put the visitor ID on the cart as the _ap_vid attribute; the
// storefront tracking script sets the _ap_vid cookie. Prefer the cart's, so checkout joins the visit
// that brought the buyer here, then the cookie, then a new ID.
async function visitorId(checkout) {
  const attr = ((checkout && checkout.attributes) || []).find((a) => a && a.key === COOKIE);
  let id = attr && UUID.test(attr.value || "") ? attr.value : await browser.cookie.get(COOKIE);
  if (!UUID.test(id || "")) id = uuid();
  await browser.cookie.set(`${COOKIE}=${id}; path=/; max-age=34128000; SameSite=Lax; Secure`);
  return id;
}

async function send(name, event) {
  try {
    const checkout = (event.data && event.data.checkout) || {};
    const body = {
      id: uuid(),
      visitor_id: await visitorId(checkout),
      type: name,
      source: "pixel",
      occurred_at: Date.parse(event.timestamp) || Date.now(),
      url: event.context.document.location.href,
      referrer: event.context.document.referrer || null,
      checkout_token: checkout.token || null,
      shopify_order_id: (checkout.order && checkout.order.id && String(checkout.order.id).replace(/\D/g, "")) || null,
    };
    fetch(ENDPOINT, { method: "POST", body: JSON.stringify(body), keepalive: true, mode: "cors", credentials: "omit" });
  } catch {
    // Never break checkout.
  }
}

// Each event is written out literally: Shopify only detects subscriptions it can see in the code.
analytics.subscribe("checkout_started", (event) => send("checkout_started", event));
analytics.subscribe("checkout_contact_info_submitted", (event) => send("checkout_contact_info_submitted", event));
analytics.subscribe("checkout_shipping_info_submitted", (event) => send("checkout_shipping_info_submitted", event));
analytics.subscribe("payment_info_submitted", (event) => send("payment_info_submitted", event));
analytics.subscribe("checkout_completed", (event) => send("checkout_completed", event));

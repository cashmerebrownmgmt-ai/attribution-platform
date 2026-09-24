import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Shopify's X-Shopify-Hmac-Sha256 header: base64 HMAC-SHA256 of the raw body,
 * keyed with the app's client secret. Constant-time; false for any missing input.
 */
export function verifyShopifyHmac(rawBody: string | Buffer, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(header, "base64");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function signShopifyBody(rawBody: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

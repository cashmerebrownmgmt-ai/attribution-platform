import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signShopifyBody, verifyShopifyHmac } from "@/lib/hmac";

const SECRET = "shpss_test_secret";
const BODY = '{"id":1,"name":"#1001"}';
const GOOD = createHmac("sha256", SECRET).update(BODY).digest("base64");

describe("verifyShopifyHmac", () => {
  it("accepts Shopify's signature for the exact body", () => {
    expect(verifyShopifyHmac(BODY, GOOD, SECRET)).toBe(true);
    expect(verifyShopifyHmac(Buffer.from(BODY), GOOD, SECRET)).toBe(true);
    expect(signShopifyBody(BODY, SECRET)).toBe(GOOD);
  });

  it("rejects a tampered body, wrong secret, missing or malformed header", () => {
    expect(verifyShopifyHmac(BODY.replace("1001", "1002"), GOOD, SECRET)).toBe(false);
    expect(verifyShopifyHmac(BODY, GOOD, "other")).toBe(false);
    expect(verifyShopifyHmac(BODY, null, SECRET)).toBe(false);
    expect(verifyShopifyHmac(BODY, "not-base64!!", SECRET)).toBe(false);
    expect(verifyShopifyHmac(BODY, GOOD.slice(0, -4), SECRET)).toBe(false);
  });

  it("rejects everything when the secret isn't configured", () => {
    expect(verifyShopifyHmac(BODY, createHmac("sha256", "").update(BODY).digest("base64"), "")).toBe(false);
  });

  it("is sensitive to whitespace re-serialization (must use the raw body)", () => {
    const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(verifyShopifyHmac(reserialized, GOOD, SECRET)).toBe(false);
  });
});

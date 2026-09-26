import { describe, expect, it } from "vitest";
import { classifyChannel, type SourceSignals } from "@/lib/channel";
import { toTouch } from "@/lib/metrics/touch";

describe("classifyChannel", () => {
  it.each<[string, SourceSignals, string]>([
    ["gclid", { gclid: "g" }, "paid_search"],
    ["msclkid", { msclkid: "m" }, "paid_search"],
    ["gclid wins over utm email", { gclid: "g", utm_medium: "email" }, "paid_search"],
    ["ttclid", { ttclid: "t" }, "paid_social"],
    ["fbclid + paid medium", { fbclid: "f", utm_medium: "paid_social" }, "paid_social"],
    ["fbclid alone (untagged Meta ad)", { fbclid: "f", referrer: "https://l.facebook.com/" }, "paid_social"],
    ["fbclid with an organic medium stays organic", { fbclid: "f", utm_source: "facebook", utm_medium: "social" }, "organic_social"],
    ["paid medium from a Facebook referrer, no source", { utm_medium: "paid", referrer: "https://m.facebook.com/" }, "paid_social"],
    ["paid medium, no source or referrer", { utm_medium: "paid" }, "paid_search"],
    ["utm cpc from google", { utm_source: "google", utm_medium: "cpc" }, "paid_search"],
    ["utm cpc from facebook", { utm_source: "facebook", utm_medium: "cpc" }, "paid_social"],
    ["utm paidsocial", { utm_source: "tiktok", utm_medium: "paidsocial" }, "paid_social"],
    ["medium case-insensitive", { utm_medium: "CPC" }, "paid_search"],
    ["email", { utm_source: "newsletter", utm_medium: "email" }, "email"],
    ["klaviyo source", { utm_source: "Klaviyo", utm_medium: "flow" }, "email"],
    ["sms", { utm_medium: "sms" }, "sms"],
    ["affiliate", { utm_medium: "affiliate" }, "affiliate"],
    ["social medium", { utm_source: "instagram", utm_medium: "social" }, "organic_social"],
    ["source only, social", { utm_source: "ig" }, "organic_social"],
    ["source only, unknown", { utm_source: "podcast-xyz" }, "other_campaign"],
    ["google referrer", { referrer: "https://www.google.com/" }, "organic_search"],
    ["google.co.uk referrer", { referrer: "https://www.google.co.uk/" }, "organic_search"],
    ["duckduckgo referrer", { referrer: "https://duckduckgo.com/" }, "organic_search"],
    ["instagram referrer", { referrer: "https://l.instagram.com/" }, "organic_social"],
    ["t.co referrer", { referrer: "https://t.co/abc" }, "organic_social"],
    ["blog referrer", { referrer: "https://someblog.com/post" }, "referral"],
    ["lookalike host isn't social", { referrer: "https://notfacebook.com/" }, "referral"],
    ["nothing", {}, "direct"],
    ["bad referrer", { referrer: "::" }, "direct"],
  ])("%s", (_name, signals, expected) => {
    expect(classifyChannel(signals)).toBe(expected);
  });
});

describe("toTouch platform", () => {
  it("credits Meta for an untagged ad click and for a paid visit from Instagram", () => {
    expect(toTouch({ fbclid: "f", referrer: "https://l.facebook.com/" })).toMatchObject({ channel: "paid_social", platform: "meta" });
    expect(toTouch({ utm_medium: "paid", referrer: "https://l.instagram.com/" })).toMatchObject({ channel: "paid_social", platform: "meta" });
  });
  it("gives organic Instagram traffic no platform", () => {
    expect(toTouch({ referrer: "https://l.instagram.com/" })).toMatchObject({ channel: "organic_social", platform: null });
  });
});

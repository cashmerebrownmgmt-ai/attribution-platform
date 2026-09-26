import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ctaLabel, dateWindows, landingUrl, mapAd, mapCampaign, mapInsight, mapStatus, MetaApiError, metaClient, purchases, syncMeta, type MetaFetch, type MetaStore } from "@/lib/meta";

const NOW = "2026-09-25T12:00:00.000Z";

describe("mappers", () => {
  it("maps statuses and CTA labels", () => {
    expect(mapStatus("ACTIVE")).toBe("active");
    expect(mapStatus("CAMPAIGN_PAUSED")).toBe("paused");
    expect(mapStatus(null, "ARCHIVED")).toBe("archived");
    expect(ctaLabel("SHOP_NOW")).toBe("Shop now");
    expect(ctaLabel("NO_BUTTON")).toBeNull();
  });

  it("adds URL parameters to the landing link, keeping existing query and hash", () => {
    expect(landingUrl("https://s.com/p", "utm_source=meta&utm_content={{ad.id}}")).toBe("https://s.com/p?utm_source=meta&utm_content={{ad.id}}");
    expect(landingUrl("https://s.com/p?v=1#top", "?utm_source=meta")).toBe("https://s.com/p?v=1&utm_source=meta#top");
    expect(landingUrl("https://s.com/p", null)).toBe("https://s.com/p");
    expect(landingUrl(null, null)).toBeNull();
  });

  it("converts budgets from cents and trims objectives", () => {
    expect(mapCampaign({ id: "1", name: "Sales", effective_status: "ACTIVE", objective: "OUTCOME_SALES", daily_budget: "2500" }, "99", NOW)).toEqual({
      platform: "meta",
      id: "1",
      account_id: "99",
      name: "Sales",
      status: "active",
      objective: "sales",
      daily_budget: 25,
      updated_at: NOW,
    });
  });

  it("maps a video ad from its story spec, and an image ad to its full-size image", () => {
    const video = mapAd(
      {
        id: "a1",
        name: "UGC hook",
        adset_id: "s1",
        campaign_id: "c1",
        effective_status: "ADSET_PAUSED",
        created_time: "2026-09-01T10:00:00-0700",
        creative: {
          thumbnail_url: "https://cdn/thumb.jpg",
          url_tags: "utm_source=meta&utm_content={{ad.id}}",
          object_story_spec: { video_data: { video_id: "v9", message: "Cook up faster", title: "808 Essentials", call_to_action: { type: "SHOP_NOW", value: { link: "https://cashmerebrown.com/products/808" } } } },
        },
      },
      NOW,
    );
    expect(video).toMatchObject({ format: "video", status: "paused", body: "Cook up faster", headline: "808 Essentials", cta: "Shop now", thumbnail_url: "https://cdn/thumb.jpg", landing_url: "https://cashmerebrown.com/products/808?utm_source=meta&utm_content={{ad.id}}", launched_at: "2026-09-01T17:00:00.000Z" });

    const image = mapAd({ id: "a2", adset_id: "s1", campaign_id: "c1", creative: { thumbnail_url: "https://cdn/small.jpg", image_url: "https://cdn/full.jpg", title: "Kit", call_to_action_type: "LEARN_MORE", object_story_spec: { link_data: { link: "https://s.com" } } } }, NOW);
    expect(image).toMatchObject({ format: "image", thumbnail_url: "https://cdn/full.jpg", headline: "Kit", cta: "Learn more", landing_url: "https://s.com", video_url: null });
  });

  it("counts purchases once, preferring omni_purchase", () => {
    expect(purchases([{ action_type: "offsite_conversion.fb_pixel_purchase", value: "3" }, { action_type: "omni_purchase", value: "4" }, { action_type: "purchase", value: "4" }])).toBe(4);
    expect(purchases([{ action_type: "link_click", value: "40" }])).toBeNull();
    expect(purchases(null)).toBeNull();
  });

  it("maps a daily insight row", () => {
    expect(
      mapInsight(
        {
          ad_id: "a1",
          date_start: "2026-09-24",
          spend: "12.345",
          impressions: "1500",
          inline_link_clicks: "31",
          reach: "1200",
          actions: [{ action_type: "purchase", value: "2" }],
          action_values: [{ action_type: "purchase", value: "78.00" }],
          video_play_actions: [{ action_type: "video_view", value: "640" }],
        },
        NOW,
      ),
    ).toEqual({ platform: "meta", ad_id: "a1", date: "2026-09-24", spend: 12.35, impressions: 1500, clicks: 31, reach: 1200, video_views: 640, platform_conversions: 2, platform_revenue: 78, updated_at: NOW });
  });
});

function fakeFetch(routes: Record<string, unknown[]>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f: MetaFetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const path = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, "");
    const queue = routes[path];
    if (!queue?.length) return { status: 404, json: async () => ({ error: { message: `no route ${path}`, code: 100 } }) };
    const next = queue.shift() as { status?: number; body: unknown };
    return { status: next.status ?? 200, json: async () => next.body };
  };
  return { f, calls };
}

describe("metaClient", () => {
  const row = z.object({ id: z.string() });

  it("follows paging, sends the token in a header only, and adds appsecret_proof", async () => {
    const { f, calls } = fakeFetch({
      "act_1/ads": [{ body: { data: [{ id: "a" }], paging: { next: "https://graph.facebook.com/v26.0/act_1/ads?after=X" } } }, { body: { data: [{ id: "b" }] } }],
    });
    const rows = await metaClient({ token: "TOKEN", appSecret: "shh", fetch: f }).getAll("act_1/ads", { limit: "1" }, row);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => !c.url.includes("TOKEN") && c.headers.Authorization === "Bearer TOKEN" && c.url.includes("appsecret_proof="))).toBe(true);
  });

  it("halves the page size when Meta asks for less data", async () => {
    const { f, calls } = fakeFetch({
      "act_1/ads": [{ status: 500, body: { error: { message: "Please reduce the amount of data you're asking for, then retry your request", code: 1 } } }, { body: { data: [{ id: "a" }] } }],
    });
    const rows = await metaClient({ token: "T", fetch: f, sleep: async () => {} }).getAll("act_1/ads", { limit: "100" }, row);
    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(2); // no pointless retries of the oversized request
    expect(new URL(calls.at(-1)!.url).searchParams.get("limit")).toBe("50");
  });

  it("does not follow paging links to other hosts", async () => {
    const { f, calls } = fakeFetch({ "act_1/ads": [{ body: { data: [{ id: "a" }], paging: { next: "https://evil.example/steal" } } }] });
    await metaClient({ token: "T", fetch: f }).getAll("act_1/ads", {}, row);
    expect(calls).toHaveLength(1);
  });

  it("retries rate limits with backoff, then gives up with the API's message", async () => {
    const limited = { status: 400, body: { error: { message: "User request limit reached", code: 17 } } };
    const waits: number[] = [];
    const ok = fakeFetch({ act_1: [limited, { body: { id: "x" } }] });
    const one = await metaClient({ token: "T", fetch: ok.f, sleep: async (ms) => void waits.push(ms) }).getOne("act_1", {}, row);
    expect(one.id).toBe("x");
    expect(waits).toEqual([2000]);

    const bad = fakeFetch({ act_1: [{ status: 400, body: { error: { message: "Invalid OAuth access token", code: 190 } } }] });
    await expect(metaClient({ token: "T", fetch: bad.f, sleep: async () => {} }).getOne("act_1", {}, row)).rejects.toMatchObject({ code: 190, message: "Invalid OAuth access token" });
    await expect(metaClient({ token: "T", fetch: fakeFetch({ act_1: [limited, limited, limited, limited] }).f, sleep: async () => {} }).getOne("act_1", {}, row)).rejects.toBeInstanceOf(MetaApiError);
  });
});

describe("syncMeta", () => {
  function setup() {
    const { f } = fakeFetch({
      act_42: [{ body: { id: "act_42", account_id: "42", name: "CB - Back Up", currency: "USD", timezone_name: "America/New_York" } }],
      "act_42/campaigns": [{ body: { data: [{ id: "c1", name: "Sales", effective_status: "ACTIVE", daily_budget: "5000" }] } }],
      "act_42/adsets": [{ body: { data: [{ id: "s1", campaign_id: "c1", effective_status: "ACTIVE" }, { id: "s-orphan", campaign_id: "c-missing" }] } }],
      "act_42/ads": [{ body: { data: [{ id: "a1", adset_id: "s1", campaign_id: "c1", effective_status: "ACTIVE", creative: {} }, { id: "a-orphan", adset_id: "s-orphan", campaign_id: "c-missing" }] } }],
      "act_42/insights": [
        {
          body: {
            data: [
              { ad_id: "a1", date_start: "2026-09-23", spend: "10", impressions: "100", inline_link_clicks: "3" },
              { ad_id: "a1", date_start: "2026-09-24", spend: "15.5", impressions: "120", inline_link_clicks: "4" },
              { ad_id: "gone", date_start: "2026-09-24", spend: "2", impressions: "5" },
            ],
          },
        },
        // Account level (what Ads Manager shows for the whole account).
        { body: { data: [{ date_start: "2026-09-23", spend: "10" }, { date_start: "2026-09-24", spend: "17.5" }] } },
      ],
    });
    const written: Record<string, unknown[]> = {};
    const put = (k: string) => async (rows: unknown) => void (written[k] = Array.isArray(rows) ? rows : [rows]);
    const store: MetaStore = { upsertAccount: put("account"), upsertCampaigns: put("campaigns"), upsertAdGroups: put("adGroups"), upsertAds: put("ads"), upsertInsights: put("insights"), upsertAccountDaily: put("accountDaily") };
    return { client: metaClient({ token: "T", fetch: f }), store, written };
  }

  it("writes the hierarchy parents-first and skips rows whose parent is missing", async () => {
    const { client, store, written } = setup();
    const s = await syncMeta({ client, store, now: () => new Date(NOW) }, { accountId: "act_42", since: "2026-09-23", until: "2026-09-24" });
    // The deleted ad's $2 is in Meta's account total but has no ad to attach to; the gap is reported.
    expect(s).toEqual({ account: "CB - Back Up", campaigns: 1, adSets: 1, ads: 1, insightRows: 2, skippedInsights: 1, spend: 25.5, accountSpend: 27.5, since: "2026-09-23", until: "2026-09-24", dryRun: false });
    expect(Object.keys(written)).toEqual(["account", "campaigns", "adGroups", "ads", "insights", "accountDaily"]);
    expect(written.account).toEqual([{ platform: "meta", id: "42", name: "CB - Back Up", currency: "USD", timezone: "America/New_York", synced_at: NOW }]);
    expect(written.accountDaily).toEqual([
      { platform: "meta", account_id: "42", date: "2026-09-23", spend: 10, updated_at: NOW },
      { platform: "meta", account_id: "42", date: "2026-09-24", spend: 17.5, updated_at: NOW },
    ]);
  });

  it("writes nothing on a dry run, and rejects bad dates", async () => {
    const { client, store, written } = setup();
    await syncMeta({ client, store }, { accountId: "42", since: "2026-09-23", until: "2026-09-24", dryRun: true });
    expect(written).toEqual({});
    await expect(syncMeta({ client, store }, { accountId: "42", since: "yesterday", until: "2026-09-24" })).rejects.toThrow("YYYY-MM-DD");
  });
});

describe("dateWindows", () => {
  it("splits a range into week-long windows", () => {
    expect(dateWindows("2026-09-01", "2026-09-16", 7)).toEqual([
      { since: "2026-09-01", until: "2026-09-07" },
      { since: "2026-09-08", until: "2026-09-14" },
      { since: "2026-09-15", until: "2026-09-16" },
    ]);
    expect(dateWindows("2026-09-01", "2026-09-01", 7)).toEqual([{ since: "2026-09-01", until: "2026-09-01" }]);
  });
});

describe("parsePreviewIframe", async () => {
  const { parsePreviewIframe } = await import("@/lib/meta");
  it("extracts the preview URL and size", () => {
    expect(parsePreviewIframe('<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=AQ1&amp;t=AQ2" width="335" height="450" scrolling="yes"></iframe>')).toEqual({
      src: "https://business.facebook.com/ads/api/preview_iframe.php?d=AQ1&t=AQ2",
      width: 335,
      height: 450,
    });
  });
  it("only accepts https facebook.com URLs", () => {
    expect(parsePreviewIframe('<iframe src="https://evil.example/x" width="1" height="1">')).toBeNull();
    expect(parsePreviewIframe('<iframe src="https://facebook.com.evil.example/x">')).toBeNull();
    expect(parsePreviewIframe('<iframe src="http://www.facebook.com/x">')).toBeNull();
    expect(parsePreviewIframe('<iframe src="javascript:alert(1)">')).toBeNull();
    expect(parsePreviewIframe("no iframe")).toBeNull();
    expect(parsePreviewIframe('<iframe src="https://www.facebook.com/x">')).toMatchObject({ width: 335, height: 560 });
  });
});

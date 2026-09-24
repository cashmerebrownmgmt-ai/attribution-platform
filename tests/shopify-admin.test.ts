import { describe, expect, it, vi } from "vitest";
import { adminClient, normalizeShop, webhooksToCreate, WEBHOOK_TOPICS } from "@/lib/shopify-admin";

describe("normalizeShop", () => {
  it("accepts myshopify domains in any form", () => {
    expect(normalizeShop(" https://My-Store.myshopify.com/admin ")).toBe("my-store.myshopify.com");
  });
  it("rejects anything else", () => {
    expect(() => normalizeShop("mystore.com")).toThrow(/myshopify/);
    expect(() => normalizeShop("evil.com/x.myshopify.com")).toThrow();
  });
});

describe("webhooksToCreate", () => {
  const uri = "https://app.example/api/webhooks/shopify";
  it("creates only what's missing for this URI", () => {
    expect(webhooksToCreate([], uri)).toEqual([...WEBHOOK_TOPICS]);
    expect(
      webhooksToCreate(
        [
          { id: "1", topic: "ORDERS_CREATE", uri },
          { id: "2", topic: "ORDERS_PAID", uri: "https://old.example/hook" },
        ],
        uri,
      ),
    ).toEqual(["ORDERS_UPDATED", "ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE"]);
  });
});

describe("adminClient", () => {
  it("gets a client-credentials token once and reuses it", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void init;
      const u = String(url);
      if (u.endsWith("/admin/oauth/access_token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 86399 }));
      return new Response(JSON.stringify({ data: { shop: { name: "S" } } }));
    });
    const c = adminClient({ shop: "s.myshopify.com", clientId: "id", clientSecret: "sec" }, fetchMock as unknown as typeof fetch);
    await c.graphql("{ shop { name } }");
    await c.graphql("{ shop { name } }");
    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("access_token"));
    expect(tokenCalls).toHaveLength(1);
    const gql = fetchMock.mock.calls.find(([u]) => String(u).includes("graphql.json"))!;
    expect(String(gql[0])).toBe("https://s.myshopify.com/admin/api/2026-07/graphql.json");
    expect((gql[1] as RequestInit).headers).toMatchObject({ "X-Shopify-Access-Token": "tok" });
  });
  it("surfaces GraphQL errors and token failures", async () => {
    const bad = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(adminClient({ shop: "s.myshopify.com", clientId: "a", clientSecret: "b" }, bad as unknown as typeof fetch).graphql("{x}")).rejects.toThrow(/token request failed \(401\)/);
  });
});

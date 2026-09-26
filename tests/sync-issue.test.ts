import { describe, expect, it } from "vitest";
import { syncIssueCheck } from "@/lib/metrics/health";

describe("failing ad-platform sync", () => {
  it("explains a blocked Meta token and how to fix it", () => {
    const c = syncIssueCheck({ platform: "meta", message: "API access blocked.", lastSyncedAt: "2026-09-26T16:45:00Z" }, Date.parse("2026-09-26T18:45:00Z"));
    expect(c).toMatchObject({ name: "Meta sync is failing", level: "bad" });
    expect(c.detail).toContain('Meta says: "API access blocked."');
    expect(c.detail).toContain("2 h ago");
    expect(c.fix).toMatch(/new token/);
  });
  it("suggests a retry for other errors", () => {
    expect(syncIssueCheck({ platform: "meta", message: "Please reduce the amount of data", lastSyncedAt: null }, 0).fix).toMatch(/Refresh/);
  });
});

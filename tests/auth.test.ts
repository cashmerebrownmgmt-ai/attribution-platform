import { describe, expect, it } from "vitest";
import { atLeast, can, devBypassEnabled, isRole } from "@/lib/roles";
import { safeNext } from "@/lib/safe-next";

describe("roles", () => {
  it("orders owner > admin > viewer", () => {
    expect(atLeast("owner", "admin")).toBe(true);
    expect(atLeast("admin", "admin")).toBe(true);
    expect(atLeast("viewer", "admin")).toBe(false);
    expect(atLeast(null, "viewer")).toBe(false);
  });
  it("gates actions by role", () => {
    expect(can.viewDashboard("viewer")).toBe(true);
    expect(can.viewOrderExplorer("viewer")).toBe(false);
    expect(can.editSettings("admin")).toBe(true);
    expect(can.manageTeam("admin")).toBe(false);
    expect(can.manageTeam("owner")).toBe(true);
  });
  it("recognizes valid roles only", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});

describe("dev login bypass", () => {
  it("only works in development with the flag set", () => {
    expect(devBypassEnabled({ NODE_ENV: "development", AUTH_DEV_BYPASS: "1" })).toBe(true);
    expect(devBypassEnabled({ NODE_ENV: "production", AUTH_DEV_BYPASS: "1" })).toBe(false);
    expect(devBypassEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devBypassEnabled({ NODE_ENV: "development", AUTH_DEV_BYPASS: "true" })).toBe(false);
  });
});

describe("safeNext", () => {
  it("allows same-site paths and blocks open redirects", () => {
    expect(safeNext("/dashboard/campaigns?range=7d")).toBe("/dashboard/campaigns?range=7d");
    expect(safeNext("https://evil.example")).toBe("/dashboard");
    expect(safeNext("//evil.example")).toBe("/dashboard");
    expect(safeNext("/\\evil.example")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
  });
});

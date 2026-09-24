/** Team roles, most to least powerful. Pure. */
export const ROLES = ["owner", "admin", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/** True when `role` has at least the power of `min`. */
export function atLeast(role: Role | null | undefined, min: Role): boolean {
  return !!role && ROLES.indexOf(role) <= ROLES.indexOf(min);
}

/** Who may do what. Owners change roles and remove people; admins invite and edit settings. */
export const can = {
  viewDashboard: (r: Role | null) => atLeast(r, "viewer"),
  viewOrderExplorer: (r: Role | null) => atLeast(r, "admin"),
  editSettings: (r: Role | null) => atLeast(r, "admin"),
  invite: (r: Role | null) => atLeast(r, "admin"),
  manageTeam: (r: Role | null) => atLeast(r, "owner"),
};

/**
 * Local-only login bypass for development (`AUTH_DEV_BYPASS=1` with `next dev`).
 * Never active in production builds, whatever the environment says.
 */
export function devBypassEnabled(env: { NODE_ENV?: string; AUTH_DEV_BYPASS?: string }): boolean {
  return env.NODE_ENV === "development" && env.AUTH_DEV_BYPASS === "1";
}

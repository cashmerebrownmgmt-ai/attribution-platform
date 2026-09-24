import "server-only";
import { redirect } from "next/navigation";
import { isOwnerEmail } from "./access";
import { db } from "./db";
import { atLeast, devBypassEnabled, isRole, type Role } from "./roles";
import { supabaseServer } from "./supabase/server";

export type Member = { userId: string; email: string; role: Role; devBypass: boolean };

/**
 * The signed-in team member, or a redirect to /login. The first person ever to sign in becomes the
 * owner; after that only invited emails are admitted (join_team). `min` enforces a role.
 */
export async function requireMember(min: Role = "viewer", next = "/dashboard"): Promise<Member> {
  if (devBypassEnabled(process.env)) {
    return { userId: "00000000-0000-0000-0000-000000000000", email: "dev@localhost", role: "owner", devBypass: true };
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect(`/login?next=${encodeURIComponent(next)}`);

  // Only the owner, with a confirmed email, may use the platform. Anyone else is signed out.
  if (!isOwnerEmail(user.email, process.env) || !user.email_confirmed_at) {
    await supabase.auth.signOut();
    redirect("/login?error=not_allowed");
  }

  const { data: role, error } = await db().rpc("join_team", { p_user_id: user.id, p_email: user.email });
  if (error) throw new Error(`join_team failed: ${error.message}`);
  if (!isRole(role)) redirect("/login?error=not_allowed");
  if (!atLeast(role, min)) redirect("/dashboard?error=forbidden");

  return { userId: user.id, email: user.email, role, devBypass: false };
}

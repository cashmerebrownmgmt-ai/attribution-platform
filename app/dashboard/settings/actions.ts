"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { db } from "@/lib/db";
import { profileSchema, settingsSchema } from "@/lib/settings";

const blankToNull = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

function done(section: string, error?: string): never {
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/settings?${error ? `error=${encodeURIComponent(error)}` : `saved=${section}`}#${section}`);
}

export async function saveTargets(form: FormData) {
  await requireMember("admin", "/dashboard/settings");
  const parsed = settingsSchema.safeParse({
    currency: String(form.get("currency") ?? "USD").toUpperCase(),
    target_roas: blankToNull(form.get("target_roas")),
    target_cpa: blankToNull(form.get("target_cpa")),
    breakeven_roas: blankToNull(form.get("breakeven_roas")),
    lookback_days: form.get("lookback_days"),
    business_name: blankToNull(form.get("business_name")),
  });
  if (!parsed.success) done("targets", parsed.error.issues[0]?.message ?? "Invalid value");
  const { error } = await db().from("settings").update({ ...parsed.data, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) done("targets", "Couldn't save. Is the dashboard migration applied?");
  done("targets");
}

export async function saveProfile(form: FormData) {
  await requireMember("admin", "/dashboard/settings");
  const parsed = profileSchema.safeParse({
    products: form.get("products") ?? "",
    audience: form.get("audience") ?? "",
    price_range: form.get("price_range") ?? "",
    brand_voice: form.get("brand_voice") ?? "",
    gross_margin_pct: blankToNull(form.get("gross_margin_pct")),
    competitors: form.get("competitors") ?? "",
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) done("profile", parsed.error.issues[0]?.message ?? "Invalid value");
  const { error } = await db().from("settings").update({ business_profile: parsed.data, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) done("profile", "Couldn't save the profile.");
  done("profile");
}

const inviteSchema = z.object({ email: z.email().max(254), role: z.enum(["admin", "viewer"]) });

export async function inviteMember(form: FormData) {
  const me = await requireMember("admin", "/dashboard/settings");
  const parsed = inviteSchema.safeParse({ email: String(form.get("email") ?? "").trim().toLowerCase(), role: form.get("role") });
  if (!parsed.success) done("team", "Enter a valid email and role.");
  // Only owners may create admins.
  if (parsed.data.role === "admin" && me.role !== "owner") done("team", "Only the owner can invite admins.");
  const existing = await db().from("members").select("user_id").eq("email", parsed.data.email).maybeSingle();
  if (existing.data) done("team", "That person is already on the team.");
  const { error } = await db()
    .from("invites")
    .upsert({ email: parsed.data.email, role: parsed.data.role, invited_by: me.devBypass ? null : me.userId });
  if (error) done("team", "Couldn't save the invite.");
  done("team");
}

export async function cancelInvite(form: FormData) {
  await requireMember("admin", "/dashboard/settings");
  await db().from("invites").delete().eq("email", String(form.get("email") ?? ""));
  done("team");
}

export async function changeRole(form: FormData) {
  const me = await requireMember("owner", "/dashboard/settings");
  const userId = String(form.get("user_id") ?? "");
  const role = z.enum(["admin", "viewer"]).safeParse(form.get("role"));
  if (!role.success || userId === me.userId) done("team", "You can't change your own role.");
  const { error } = await db().from("members").update({ role: role.data }).eq("user_id", userId).neq("role", "owner");
  if (error) done("team", "Couldn't change the role.");
  done("team");
}

export async function removeMember(form: FormData) {
  const me = await requireMember("owner", "/dashboard/settings");
  const userId = String(form.get("user_id") ?? "");
  if (userId === me.userId) done("team", "You can't remove yourself.");
  const { error } = await db().from("members").delete().eq("user_id", userId).neq("role", "owner");
  if (error) done("team", "Couldn't remove that person.");
  done("team");
}

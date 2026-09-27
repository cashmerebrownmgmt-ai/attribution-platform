"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { db } from "@/lib/db";
import { passwordProblem } from "@/lib/password";
import { profileSchema, settingsSchema } from "@/lib/settings";
import { supabaseServer } from "@/lib/supabase/server";
import { z } from "zod";
import { notifySchema } from "@/lib/goal-alerts";
import { removeSubscription, saveSubscription, sendPushes } from "@/lib/push";

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

/** The owner sets or changes their sign-in password. The value never leaves this request. */
export async function setPassword(form: FormData) {
  const me = await requireMember("owner", "/dashboard/settings");
  const back = (code: string): never => redirect(`/dashboard/settings?pw=${code}#security`);
  if (me.devBypass) back("failed");
  const password = String(form.get("password") ?? "");
  const problem = passwordProblem(password, String(form.get("confirm") ?? ""), me.email);
  if (problem) back(problem);

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // Supabase can require a recent sign-in before changing a password.
    const reauth = error.code === "reauthentication_needed" || /reauthenticat/i.test(error.message);
    console.warn("settings: password update failed", error.status, error.code ?? "");
    back(reauth ? "reauth" : error.code === "weak_password" ? "too_simple" : "failed");
  }
  back("set");
}

// ─── Phone app & notifications ───────────────────────────────────────────────

const pushSubSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
});

/** Called from the phone after the owner allows notifications. */
export async function savePushSubscription(sub: unknown, device: string | null): Promise<{ ok: boolean; error?: string }> {
  await requireMember("admin", "/dashboard/settings");
  const parsed = pushSubSchema.safeParse(sub);
  if (!parsed.success) return { ok: false, error: "That device's subscription looks invalid." };
  try {
    await saveSubscription(parsed.data, device ? device.slice(0, 60) : null);
  } catch {
    return { ok: false, error: "Couldn't save this device. Is the phone-app migration applied?" };
  }
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await requireMember("admin", "/dashboard/settings");
  if (typeof endpoint === "string" && endpoint.startsWith("https://")) await removeSubscription(endpoint);
  revalidatePath("/dashboard/settings");
}

export async function sendTestPush(): Promise<{ sent: number; devices: number }> {
  await requireMember("admin", "/dashboard/settings");
  const r = await sendPushes([{ id: `test:${Date.now()}`, title: "Notifications are on ✅", body: "You'll get your goal alerts and morning report here.", url: "/dashboard/settings#phone" }]);
  return { sent: r.sent, devices: r.devices };
}

export async function saveNotify(form: FormData) {
  await requireMember("admin", "/dashboard/settings");
  const parsed = notifySchema.safeParse({
    spendCap: blankToNull(form.get("spendCap")),
    revenueGoal: blankToNull(form.get("revenueGoal")),
    lossMinSpend: blankToNull(form.get("lossMinSpend")) ?? 50,
    on: { spendCap: form.has("on_spendCap"), loss: form.has("on_loss"), revenueGoal: form.has("on_revenueGoal"), daily: form.has("on_daily") },
  });
  if (!parsed.success) done("phone", parsed.error.issues[0]?.message ?? "Invalid value");
  const { error } = await db().from("settings").update({ notify: parsed.data, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) done("phone", "Couldn't save. Is the phone-app migration applied?");
  done("phone");
}

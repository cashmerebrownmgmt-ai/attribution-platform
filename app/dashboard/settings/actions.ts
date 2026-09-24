"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireMember } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays } from "@/lib/metrics/compute";
import { newTestSchema } from "@/lib/tests-data";
import { storeToday } from "@/lib/tz";

const back = (q: string): never => redirect(`/dashboard/tests?${q}`);

export async function createTest(form: FormData) {
  await requireMember("owner", "/dashboard/tests");
  const design = form.get("design") === "cut" ? "cut" : "pause";
  const parsed = newTestSchema.safeParse({
    name: String(form.get("name") ?? "").trim() || "Meta test",
    design,
    cut_share: design === "pause" ? 1 : form.get("cut_share"),
    campaign_id: String(form.get("campaign_id") ?? "") || null,
    start_date: form.get("start_date"),
    days: form.get("days"),
    exclude_email: form.get("exclude_email") === "on",
    notes: String(form.get("notes") ?? "").trim() || null,
  });
  if (!parsed.success) back(`error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the form")}`);
  const v = parsed.data!;
  if (v.start_date < storeToday()) back(`error=${encodeURIComponent("Pick a start date from today on.")}`);
  const { data, error } = await db()
    .from("incrementality_tests")
    .insert({ name: v.name, design: v.design, cut_share: v.cut_share, platform: "meta", campaign_id: v.campaign_id, start_date: v.start_date, end_date: addDays(v.start_date, v.days - 1), exclude_email: v.exclude_email, notes: v.notes })
    .select("id")
    .single();
  if (error) back(`error=${encodeURIComponent("Couldn't save the test. Is the database update applied?")}`);
  revalidatePath("/dashboard/tests");
  back(`id=${data!.id}`);
}

const idSchema = z.string().uuid();

export async function cancelTest(form: FormData) {
  await requireMember("owner", "/dashboard/tests");
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) back("error=Unknown%20test");
  await db().from("incrementality_tests").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id.data!);
  revalidatePath("/dashboard/tests");
  back(`id=${id.data}`);
}

export async function deleteTest(form: FormData) {
  await requireMember("owner", "/dashboard/tests");
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) back("error=Unknown%20test");
  await db().from("incrementality_tests").delete().eq("id", id.data!);
  revalidatePath("/dashboard/tests");
  back("deleted=1");
}

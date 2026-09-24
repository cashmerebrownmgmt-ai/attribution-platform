"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";

const emailSchema = z.email().max(254);

/** Who may receive a sign-in link: anyone before the first owner exists, then members and invitees. */
async function mayJoin(email: string): Promise<boolean> {
  const { count, error } = await db().from("members").select("user_id", { count: "exact", head: true });
  if (error) throw new Error(`members check failed: ${error.message}`);
  if (!count) return true;
  const [m, i] = await Promise.all([
    db().from("members").select("user_id").eq("email", email).maybeSingle(),
    db().from("invites").select("email").eq("email", email).maybeSingle(),
  ]);
  return !!m.data || !!i.data;
}

export async function sendMagicLink(formData: FormData) {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  const next = safeNext(String(formData.get("next") ?? ""));
  if (!parsed.success) redirect(`/login?error=invalid_email&next=${encodeURIComponent(next)}`);
  const email = parsed.data;

  // Same response either way, so the form doesn't reveal who has access.
  if (await mayJoin(email)) {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "http";
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${proto}://${host}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      console.warn("login: magic link failed", error.message);
      redirect(`/login?error=send_failed&next=${encodeURIComponent(next)}`);
    }
  }
  redirect(`/login?sent=1&next=${encodeURIComponent(next)}`);
}

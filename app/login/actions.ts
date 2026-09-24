"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isOwnerEmail, ownerEmail } from "@/lib/access";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";

const emailSchema = z.email().max(254);

export async function sendMagicLink(formData: FormData) {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  const next = safeNext(String(formData.get("next") ?? ""));
  if (!parsed.success) redirect(`/login?error=invalid_email&next=${encodeURIComponent(next)}`);
  if (!ownerEmail(process.env)) redirect("/login?error=not_configured");

  // Only the owner's email gets a link. Same response either way, so the form doesn't reveal who that is.
  if (isOwnerEmail(parsed.data, process.env)) {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "http";
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: { shouldCreateUser: true, emailRedirectTo: `${proto}://${host}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      console.warn("login: magic link failed", error.status, error.code ?? error.message);
      const code = error.status === 429 || /rate/i.test(error.message) ? "rate_limited" : "send_failed";
      redirect(`/login?error=${code}&next=${encodeURIComponent(next)}`);
    }
  }
  redirect(`/login?sent=1&next=${encodeURIComponent(next)}`);
}

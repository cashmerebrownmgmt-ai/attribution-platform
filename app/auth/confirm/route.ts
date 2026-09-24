import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { authErrorCode } from "@/lib/access";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

/**
 * Magic-link landing that works in any browser: the email carries a one-time token hash
 * (Supabase email template: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email),
 * verified server-side. Access is still checked by the page (owner email only).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));

  if (!tokenHash || !type || !TYPES.includes(type)) {
    return NextResponse.redirect(new URL("/login?error=link_failed", url.origin));
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    console.warn("auth confirm: verify failed", error.code ?? error.message);
    return NextResponse.redirect(new URL(`/login?error=${authErrorCode({ error_code: error.code, error_description: error.message })}`, url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}

import { NextResponse } from "next/server";
import { authErrorCode } from "@/lib/access";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";

/** Magic-link landing: swap the one-time code for a session, then continue. Access is checked by the page. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const next = safeNext(q.get("next"));
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, url.origin));

  // Supabase reports expired/invalid links by redirecting here with error parameters.
  if (q.get("error") || q.get("error_code")) {
    return fail(authErrorCode({ error: q.get("error"), error_code: q.get("error_code"), error_description: q.get("error_description") }));
  }
  const code = q.get("code");
  if (!code) return fail("link_failed");

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn("auth callback: code exchange failed", error.code ?? error.message);
    return fail(authErrorCode({ error_code: error.code, error_description: error.message }));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}

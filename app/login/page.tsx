import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";
import { sendMagicLink } from "./actions";
import s from "./login.module.css";

export const metadata: Metadata = { title: "Sign in · Attribution", robots: { index: false } };

const ERRORS: Record<string, string> = {
  invalid_email: "That doesn't look like an email address.",
  send_failed: "We couldn't send the sign-in email. Try again in a minute.",
  not_allowed: "That account doesn't have access.",
  not_configured: "Sign-in isn't set up yet: OWNER_EMAIL is missing on the server.",
  rate_limited: "Too many sign-in emails were requested. Wait a few minutes, then try again.",
  link_expired: "That sign-in link has expired or was already used. Request a new one.",
  other_browser: "Open the sign-in link in the same browser you requested it from, or request a new link here.",
  link_failed: "That sign-in link didn't work. Request a new one.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const p = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(p.next));
  const error = ERRORS[one(p.error) ?? ""];
  const sent = one(p.sent) === "1";

  // Already signed in (and not bounced here by an error)? Go straight to the dashboard.
  if (!error) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect(next);
  }

  return (
    <main className={s.page}>
      <div className={s.card}>
        <div className={s.mark} aria-hidden="true" />
        <h1 className={s.title}>Sign in</h1>
        <p className={s.sub}>Private dashboard. We&apos;ll email the owner a one-time sign-in link.</p>
        {error && <p className={`${s.msg} ${s.bad}`} role="alert">{error}</p>}
        {sent ? (
          <p className={`${s.msg} ${s.good}`} role="status">
            If this email has access, a sign-in link is on its way. Check your inbox (and spam), and open it in this browser. The link works once and expires after an hour.
          </p>
        ) : (
          <form action={sendMagicLink}>
            <input type="hidden" name="next" value={next} />
            <label className={s.label} htmlFor="email">
              Work email
            </label>
            <input className={s.input} id="email" name="email" type="email" autoComplete="email" required autoFocus />
            <button className={s.button} type="submit">
              Email me a sign-in link
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

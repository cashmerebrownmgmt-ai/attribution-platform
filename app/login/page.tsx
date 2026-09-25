import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";
import { sendMagicLink, signInWithPassword } from "./actions";
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
  wrong_password: "That email and password don't match. Try again, or use an email link.",
  rate_limited_pw: "Too many attempts. Wait a few minutes, or sign in with an email link.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const p = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(p.next));
  const error = ERRORS[one(p.error) ?? ""];
  const sent = one(p.sent) === "1";
  const useLink = one(p.method) === "link" || sent || ["link_expired", "other_browser", "link_failed", "send_failed", "rate_limited"].includes(one(p.error) ?? "");
  const switchHref = (method: "link" | "password") => `/login?${new URLSearchParams({ ...(method === "link" ? { method } : {}), next })}`;

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
        <p className={s.sub}>Private dashboard.</p>
        {error && <p className={`${s.msg} ${s.bad}`} role="alert">{error}</p>}
        {sent ? (
          <p className={`${s.msg} ${s.good}`} role="status">
            If this email has access, a sign-in link is on its way. Check your inbox (and spam), and open it in this browser. The link works once and expires after an hour.
          </p>
        ) : useLink ? (
          <form action={sendMagicLink}>
            <input type="hidden" name="next" value={next} />
            <label className={s.label} htmlFor="email">
              Email
            </label>
            <input className={s.input} id="email" name="email" type="email" autoComplete="email" required autoFocus />
            <button className={s.button} type="submit">
              Email me a sign-in link
            </button>
          </form>
        ) : (
          <form action={signInWithPassword}>
            <input type="hidden" name="next" value={next} />
            <label className={s.label} htmlFor="email">
              Email
            </label>
            <input className={s.input} id="email" name="email" type="email" autoComplete="username" required autoFocus />
            <label className={s.label} htmlFor="password" style={{ marginTop: 12 }}>
              Password
            </label>
            <input className={s.input} id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
            <button className={s.button} type="submit">
              Sign in
            </button>
          </form>
        )}
        <p className={s.alt}>
          {useLink ? (
            <a href={switchHref("password")}>Sign in with a password</a>
          ) : (
            <>
              No password yet, or forgot it? <a href={switchHref("link")}>Email me a sign-in link</a>
            </>
          )}
        </p>
      </div>
    </main>
  );
}

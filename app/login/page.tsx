import type { Metadata } from "next";
import { safeNext } from "@/lib/safe-next";
import { sendMagicLink } from "./actions";
import s from "./login.module.css";

export const metadata: Metadata = { title: "Sign in · Attribution", robots: { index: false } };

const ERRORS: Record<string, string> = {
  invalid_email: "That doesn't look like an email address.",
  send_failed: "We couldn't send the sign-in email. Try again in a minute.",
  not_invited: "This email isn't on the team yet. Ask the owner to invite you.",
  link_failed: "That sign-in link is invalid or has expired. Request a new one.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const p = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(p.next));
  const error = ERRORS[one(p.error) ?? ""];
  const sent = one(p.sent) === "1";

  return (
    <main className={s.page}>
      <div className={s.card}>
        <div className={s.mark} aria-hidden="true" />
        <h1 className={s.title}>Sign in</h1>
        <p className={s.sub}>We&apos;ll email you a one-time sign-in link. No password needed.</p>
        {error && <p className={`${s.msg} ${s.bad}`} role="alert">{error}</p>}
        {sent ? (
          <p className={`${s.msg} ${s.good}`} role="status">
            If this email has access, a sign-in link is on its way. Check your inbox (and spam).
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

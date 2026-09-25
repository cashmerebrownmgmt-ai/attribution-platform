import "server-only";

/** Whether email sending is configured (the key's value is never exposed). */
export const emailConfigured = () => !!process.env.RESEND_API_KEY;

/**
 * Send one email through Resend's HTTP API (no SDK dependency needed for a single call).
 * Without a verified domain, Resend's test sender only delivers to the Resend account's own email.
 */
export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "Attribution alerts <onboarding@resend.dev>", ...msg, to: [msg.to] }),
  });
  if (!res.ok) return { ok: false, error: `Resend returned ${res.status}` };
  return { ok: true };
}

/** Rules for the owner's password. Pure, so the form and the tests share them. */
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

export type PasswordProblem = "too_short" | "too_long" | "mismatch" | "is_email" | "too_simple";

export function passwordProblem(password: string, confirm: string, email: string | null): PasswordProblem | null {
  if (password.length < MIN_PASSWORD) return "too_short";
  if (password.length > MAX_PASSWORD) return "too_long";
  if (password !== confirm) return "mismatch";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) return "is_email";
  if (new Set(password).size < 5) return "too_simple"; // e.g. "aaaaaaaaaaaa" or "121212121212"
  return null;
}

export const PASSWORD_MESSAGES: Record<PasswordProblem | "reauth" | "failed" | "set", string> = {
  too_short: `Use at least ${MIN_PASSWORD} characters. A few random words works well.`,
  too_long: `Use at most ${MAX_PASSWORD} characters.`,
  mismatch: "The two passwords don't match.",
  is_email: "Don't include your email name in the password.",
  too_simple: "That password is too repetitive. Mix in more different characters.",
  reauth: "For security, sign in again with an email link, then set your password within a few minutes.",
  failed: "The password couldn't be saved. Try again.",
  set: "Password saved. You can sign in with it from now on.",
};

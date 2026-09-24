/**
 * Who may use the platform: exactly the owner's email (OWNER_EMAIL). Fails closed: if it isn't
 * set, nobody gets in. Pure.
 */
export function ownerEmail(env: Record<string, string | undefined>): string | null {
  const e = env.OWNER_EMAIL?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function isOwnerEmail(email: string | null | undefined, env: Record<string, string | undefined>): boolean {
  const owner = ownerEmail(env);
  return !!owner && !!email && email.trim().toLowerCase() === owner;
}

/** Map Supabase auth errors (from the magic-link redirect or the code exchange) to login messages. */
export function authErrorCode(params: { error?: string | null; error_code?: string | null; error_description?: string | null }): string {
  const code = `${params.error_code ?? ""} ${params.error ?? ""} ${params.error_description ?? ""}`.toLowerCase();
  if (code.includes("expired")) return "link_expired";
  if (code.includes("code verifier") || code.includes("pkce") || code.includes("flow_state")) return "other_browser";
  return "link_failed";
}

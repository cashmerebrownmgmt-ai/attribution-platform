import { redirect } from "next/navigation";

/**
 * Home. If Supabase falls back to the Site URL with sign-in parameters, pass them to the auth
 * handlers; otherwise go to the dashboard (which asks for login when needed).
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const p = await searchParams;
  const one = (k: string) => (Array.isArray(p[k]) ? p[k][0] : p[k]);
  const q = new URLSearchParams();
  for (const k of ["code", "token_hash", "type", "error", "error_code", "error_description"]) {
    const v = one(k);
    if (v) q.set(k, v);
  }
  if (q.has("token_hash")) redirect(`/auth/confirm?${q}`);
  if (q.has("code") || q.has("error")) redirect(`/auth/callback?${q}`);
  redirect("/dashboard");
}

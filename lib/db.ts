import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

let client: SupabaseClient | undefined;

/**
 * Server-only Supabase client using the service role key.
 * Bypasses RLS, so it must never be imported from client components.
 */
export function db(): SupabaseClient {
  client ??= createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client;
}

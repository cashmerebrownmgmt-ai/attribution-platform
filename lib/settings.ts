import "server-only";
import { z } from "zod";
import { db } from "./db";

export const settingsSchema = z.object({
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code like USD"),
  target_roas: z.coerce.number().min(0).max(100).nullable(),
  target_cpa: z.coerce.number().min(0).max(100000).nullable(),
  breakeven_roas: z.coerce.number().min(0).max(100).nullable(),
  lookback_days: z.coerce.number().int().min(1).max(90),
  business_name: z.string().trim().max(120).nullable(),
});

export const profileSchema = z.object({
  products: z.string().trim().max(1000),
  audience: z.string().trim().max(1000),
  price_range: z.string().trim().max(200),
  brand_voice: z.string().trim().max(500),
  gross_margin_pct: z.coerce.number().min(0).max(100).nullable(),
  competitors: z.string().trim().max(500),
  notes: z.string().trim().max(2000),
});

export type SettingsRow = z.infer<typeof settingsSchema> & { business_profile: Partial<z.infer<typeof profileSchema>> };

export async function getSettings(): Promise<SettingsRow | null> {
  const { data, error } = await db().from("settings").select("*").maybeSingle();
  if (error) return null; // table missing until the dashboard migration is applied
  return data as SettingsRow | null;
}

export async function getAdAccounts(): Promise<{ platform: string; id: string; name: string | null }[]> {
  const { data, error } = await db().from("ad_accounts").select("platform, id, name");
  return error ? [] : (data ?? []);
}

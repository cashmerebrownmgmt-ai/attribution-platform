import "server-only";
import { z } from "zod";
import { db } from "./db";
import type { TestPlan } from "./incrementality";

export type StoredTest = {
  id: string;
  name: string;
  design: "pause" | "cut";
  cut_share: number;
  platform: "meta";
  campaign_id: string | null;
  start_date: string;
  end_date: string;
  baseline_days: number;
  exclude_email: boolean;
  status: "active" | "cancelled";
  notes: string | null;
  created_at: string;
};

export const newTestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    design: z.enum(["pause", "cut"]),
    cut_share: z.coerce.number().min(0.1).max(1),
    campaign_id: z.string().trim().regex(/^\d+$/).nullable(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    days: z.coerce.number().int().min(7).max(60),
    exclude_email: z.boolean(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .refine((v) => v.design === "cut" || v.cut_share === 1, { message: "A pause removes the whole budget" });

export async function listTests(): Promise<StoredTest[]> {
  const { data, error } = await db().from("incrementality_tests").select("*").order("start_date", { ascending: false });
  if (error) return []; // table missing until the migration is applied
  return (data ?? []).map((t) => ({ ...t, cut_share: Number(t.cut_share) })) as StoredTest[];
}

export const toPlan = (t: StoredTest): TestPlan => ({
  design: t.design,
  cutShare: t.cut_share,
  scope: { platform: t.platform, campaignId: t.campaign_id },
  start: t.start_date,
  end: t.end_date,
  baselineDays: t.baseline_days,
  excludeEmail: t.exclude_email,
});

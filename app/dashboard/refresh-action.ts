"use server";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { currentMode } from "@/lib/dashboard/data";
import { refreshMeta, type MetaRefresh } from "@/lib/meta-refresh";

export type RefreshResult = { at: string; meta: MetaRefresh | "demo"; message?: string };

/**
 * The dashboard's Refresh button. Shopify orders arrive in real time already; this also pulls
 * today's and yesterday's Meta numbers (unless pulled in the last minute), then re-renders every page.
 */
export async function refreshData(): Promise<RefreshResult> {
  await requireMember("viewer", "/dashboard");
  const at = new Date().toISOString();
  let result: RefreshResult;
  if ((await currentMode()) === "demo") {
    result = { at, meta: "demo" };
  } else {
    const r = await refreshMeta(60_000);
    result = { at, meta: r.status, message: r.message };
  }
  revalidatePath("/dashboard", "layout");
  return result;
}

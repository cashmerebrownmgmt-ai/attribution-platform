import { appIcon } from "@/lib/app-icon";

const SIZES = ["192", "512"] as const;

export const dynamicParams = false;
export function generateStaticParams() {
  return SIZES.map((size) => ({ size }));
}

/** PNG icons for the web app manifest (/icons/192, /icons/512). */
export async function GET(_req: Request, ctx: RouteContext<"/icons/[size]">) {
  const { size } = await ctx.params;
  return appIcon(Number(size));
}

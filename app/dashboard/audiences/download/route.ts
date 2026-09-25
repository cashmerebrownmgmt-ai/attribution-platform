import { requireMember } from "@/lib/auth";
import { audienceFile, buildAudiences, type AudiencePlatform } from "@/lib/audiences";
import { currentMode, getDashboardData } from "@/lib/dashboard/data";

const PLATFORMS: AudiencePlatform[] = ["meta", "google", "tiktok"];

/** Customer-list file for one audience and platform (?id=…&platform=meta|google|tiktok). Hashed emails only. */
export async function GET(req: Request) {
  await requireMember("owner", "/dashboard/audiences");
  const url = new URL(req.url);
  const platform = PLATFORMS.find((p) => p === url.searchParams.get("platform"));
  if (!platform) return new Response("Unknown platform", { status: 400 });

  const data = await getDashboardData(await currentMode());
  const a = buildAudiences(data, Date.parse(data.generatedAt)).find((x) => x.id === url.searchParams.get("id"));
  if (!a) return new Response("Unknown audience", { status: 404 });

  const ext = platform === "tiktok" ? "txt" : "csv";
  const name = `${data.mode === "demo" ? "demo-" : ""}${a.id}-${platform}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  return new Response(audienceFile(a, platform), {
    headers: {
      "Content-Type": `${ext === "csv" ? "text/csv" : "text/plain"}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

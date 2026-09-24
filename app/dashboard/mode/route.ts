import { NextResponse } from "next/server";
import { MODE_COOKIE } from "@/lib/dashboard/data";

/** Switch between demo and live data (per browser), then go back to the page. */
export async function POST(req: Request) {
  const form = await req.formData();
  const mode = form.get("mode") === "live" ? "live" : "demo";
  const back = req.headers.get("referer");
  const url = new URL(back && new URL(back).origin === new URL(req.url).origin ? back : "/dashboard", req.url);
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.set(MODE_COOKIE, mode, { path: "/", httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", maxAge: 60 * 60 * 24 * 365 });
  return res;
}

import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth } from "@/lib/basic-auth";

/** HTTP Basic Auth for the internal debug pages (docs/phase-1-spec.md §8). */
export function proxy(request: NextRequest) {
  const password = process.env.DEBUG_PASSWORD;
  if (!password) {
    return new NextResponse("Debug page is disabled: set DEBUG_PASSWORD.", { status: 503 });
  }
  if (!checkBasicAuth(request.headers.get("authorization"), password)) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Attribution debug", charset="UTF-8"' },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/debug", "/debug/:path*"],
};

import { NextResponse, type NextRequest } from "next/server";
import { stripKeyQueryParams } from "@/core/session-url";

/**
 * Never keep an API key in a URL. Live reads use the signed session cookie
 * from POST /api/session instead.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  if (stripKeyQueryParams(url.searchParams)) {
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse } from "next/server";

/**
 * Log a server failure without emails, raw API keys, or connector tokens.
 * Do not pass request bodies or Error.message through here.
 */
export function logServerError(context: string): void {
  console.error(context);
}

export function internalError(): NextResponse {
  return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

export function badRequest(error = "Bad Request"): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

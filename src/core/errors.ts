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

export function unauthorized(error = "Unauthorized"): NextResponse {
  return NextResponse.json({ error }, { status: 401 });
}

export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "Too Many Requests" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export function payloadTooLarge(): NextResponse {
  return NextResponse.json({ error: "Payload Too Large" }, { status: 413 });
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Read and JSON-parse a request body with a byte-size ceiling, to bound memory
 * use / DoS on write endpoints. Throws PayloadTooLargeError past the cap and
 * SyntaxError on malformed JSON.
 */
export async function readTextBounded(
  request: Request,
  maxBytes = 64 * 1024
): Promise<string> {
  const raw = await request.text();
  if (raw.length > maxBytes) {
    throw new PayloadTooLargeError();
  }
  return raw;
}

export async function readJsonBounded(
  request: Request,
  maxBytes = 64 * 1024
): Promise<unknown> {
  const raw = await readTextBounded(request, maxBytes);
  return raw ? JSON.parse(raw) : {};
}

import { NextRequest, NextResponse } from "next/server";
import {
  SessionCreateRequestSchema,
  SessionStatusResponseSchema,
} from "@/core/contracts";
import {
  authorize,
  authResponse,
  extractApiKey,
  LIVE_WORKSPACE,
} from "@/core/auth";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import {
  readBrowserSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  sessionFromAuth,
  sessionSecret,
  signSession,
} from "@/core/session";

function sessionStatus(authenticated: boolean, workspace?: string) {
  return SessionStatusResponseSchema.parse(
    authenticated ? { authenticated: true, workspace } : { authenticated: false }
  );
}

function applySessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
}

/**
 * GET /api/session
 *
 * Whether the signed browser cookie is valid. Never returns the API key.
 */
export async function GET(request: NextRequest) {
  const session = readBrowserSession(request);
  if (!session) {
    return NextResponse.json(sessionStatus(false));
  }
  return NextResponse.json(sessionStatus(true, session.workspace));
}

/**
 * POST /api/session
 *
 * Verify the API key once and set a signed httpOnly SameSite cookie.
 * The key is not stored in the cookie and must not be placed in a URL.
 */
export async function POST(request: NextRequest) {
  try {
    let raw: unknown = {};
    try {
      raw = await readJsonBounded(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return payloadTooLarge();
      if (error instanceof SyntaxError) return badRequest("Invalid JSON body");
      throw error;
    }

    const parsed = SessionCreateRequestSchema.safeParse(raw ?? {});
    const fromBody =
      parsed.success && parsed.data.key.trim().length > 0
        ? parsed.data.key.trim()
        : null;
    const key = fromBody ?? extractApiKey(request);
    if (!key) {
      return authResponse({ ok: false, status: 401, error: "Unauthorized" });
    }

    const probe = new NextRequest(request.url, {
      headers: { authorization: `Bearer ${key}` },
    });
    const auth = await authorize(probe, {
      workspace: LIVE_WORKSPACE,
      write: false,
    });
    if (!auth.ok) return authResponse(auth);

    if (!sessionSecret()) {
      return NextResponse.json(
        { error: "set ANYKPI_SECRET" },
        { status: 503 }
      );
    }

    const token = signSession(sessionFromAuth(auth));
    const response = NextResponse.json(
      sessionStatus(true, auth.keyWorkspace || LIVE_WORKSPACE)
    );
    applySessionCookie(response, token);
    return response;
  } catch {
    logServerError("Create browser session failed");
    return internalError();
  }
}

/**
 * DELETE /api/session
 *
 * Logout: clear the signed cookie. Demo stays public-read without a session.
 */
export async function DELETE() {
  const response = NextResponse.json(sessionStatus(false));
  clearSessionCookie(response);
  return response;
}

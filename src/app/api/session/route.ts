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
  resolveWorkspace,
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
  mergeSessions,
  readBrowserSession,
  SESSION_COOKIE_NAME,
  sessionAuthorizes,
  sessionCookieOptions,
  sessionFromAuth,
  sessionSecret,
  signSession,
} from "@/core/session";
import { ensureWorkspace } from "@/core/workspaces";

function sessionStatus(input: {
  authenticated: boolean;
  workspace?: string;
  workspaces?: string[];
  authorized?: boolean;
}) {
  return SessionStatusResponseSchema.parse(
    input.authenticated
      ? {
          authenticated: true,
          workspace: input.workspace,
          workspaces: input.workspaces ?? [],
          authorized: input.authorized ?? true,
        }
      : {
          authenticated: false,
          workspaces: input.workspaces,
          authorized: false,
        }
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
 * Whether the signed browser cookie is valid, and whether it unlocks
 * the requested workspace. Never returns the API key.
 */
export async function GET(request: NextRequest) {
  const requested =
    request.nextUrl.searchParams.get("workspace") ?? undefined;
  const session = readBrowserSession(request);
  if (!session) {
    return NextResponse.json(sessionStatus({ authenticated: false }));
  }
  const workspace = requested || session.workspace;
  const authorized = sessionAuthorizes(session, workspace);
  return NextResponse.json(
    sessionStatus({
      authenticated: true,
      workspace: authorized ? workspace : session.workspace,
      workspaces: session.workspaces,
      authorized,
    })
  );
}

/**
 * POST /api/session
 *
 * Verify the API key once and set a signed httpOnly SameSite cookie.
 * A second POST with another workspace's key merges that workspace onto
 * the existing ticket (one unlock per workspace). The key is not stored.
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
    const requestedWorkspace =
      parsed.success && parsed.data.workspace?.trim()
        ? parsed.data.workspace.trim()
        : undefined;
    const key = fromBody ?? extractApiKey(request);
    if (!key) {
      return authResponse({ ok: false, status: 401, error: "Unauthorized" });
    }

    const probe = new NextRequest(request.url, {
      headers: { authorization: `Bearer ${key}` },
    });
    const auth = await authorize(probe, {
      workspace: requestedWorkspace || LIVE_WORKSPACE,
      write: false,
    });
    if (!auth.ok) return authResponse(auth);

    const resolved = resolveWorkspace(
      auth,
      requestedWorkspace || LIVE_WORKSPACE,
      false
    );
    if ("ok" in resolved && resolved.ok === false) {
      return authResponse(resolved);
    }
    const unlocked = (resolved as { workspace: string }).workspace;
    if (unlocked === "demo") {
      return authResponse({
        ok: false,
        status: 401,
        error: "Unauthorized",
      });
    }
    if (
      requestedWorkspace &&
      requestedWorkspace !== "demo" &&
      !auth.canChooseWorkspace &&
      auth.keyWorkspace &&
      auth.keyWorkspace !== requestedWorkspace
    ) {
      return authResponse({ ok: false, status: 401, error: "Unauthorized" });
    }

    if (!sessionSecret()) {
      return NextResponse.json(
        { error: "set ANYKPI_SECRET" },
        { status: 503 }
      );
    }

    await ensureWorkspace(unlocked);
    const incoming = sessionFromAuth(auth, unlocked);
    incoming.workspace = unlocked;
    incoming.workspaces = [unlocked];
    const merged = mergeSessions(readBrowserSession(request), incoming);
    merged.workspace = unlocked;

    const token = signSession(merged);
    const response = NextResponse.json(
      sessionStatus({
        authenticated: true,
        workspace: unlocked,
        workspaces: merged.workspaces,
        authorized: true,
      })
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
  const response = NextResponse.json(sessionStatus({ authenticated: false }));
  clearSessionCookie(response);
  return response;
}

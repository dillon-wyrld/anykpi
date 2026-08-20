/**
 * Signed browser session for live workspace reads.
 *
 * POST /api/session verifies an API key once and sets an HMAC cookie.
 * The cookie never contains the key. Writes ignore it (see session-auth).
 *
 * ANY-39: the cookie holds one unlocked workspace per presented key.
 * Switching to a live workspace that is not yet on the ticket prompts
 * for that workspace's key; an admin/env key can choose any workspace.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { AuthActor, AuthOk, RequestLike } from "./auth";

export const SESSION_COOKIE_NAME = "anykpi_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

const SESSION_VERSION = 2;

export type BrowserSession = {
  actor: Exclude<AuthActor, "anonymous">;
  workspace: string;
  /** Workspaces unlocked by presenting a key. Cookie never stores keys. */
  workspaces: string[];
  canChooseWorkspace: boolean;
  exp: number;
};

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export function sessionSecret(): string | undefined {
  const secret = process.env.ANYKPI_SECRET?.trim();
  if (secret) return secret;
  const fallback = process.env.ANYKPI_API_KEY?.trim();
  if (fallback) return fallback;
  return undefined;
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

function uniqueWorkspaces(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function sessionFromAuth(
  auth: AuthOk,
  requestedWorkspace?: string
): BrowserSession {
  const workspace =
    auth.canChooseWorkspace
      ? requestedWorkspace || auth.keyWorkspace || "live"
      : auth.keyWorkspace || "live";
  return {
    actor: auth.actor === "hashed" ? "hashed" : "env",
    workspace,
    workspaces: uniqueWorkspaces([workspace]),
    canChooseWorkspace: auth.canChooseWorkspace,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
}

export function mergeSessions(
  existing: BrowserSession | null,
  incoming: BrowserSession
): BrowserSession {
  if (!existing) return incoming;
  const workspaces = uniqueWorkspaces([
    ...existing.workspaces,
    ...incoming.workspaces,
  ]);
  return {
    actor: incoming.actor,
    workspace: incoming.workspace,
    workspaces,
    canChooseWorkspace:
      existing.canChooseWorkspace || incoming.canChooseWorkspace,
    exp: incoming.exp,
  };
}

export function sessionAuthorizes(
  session: BrowserSession,
  workspace: string
): boolean {
  if (workspace === "demo") return true;
  if (session.canChooseWorkspace) return true;
  return session.workspaces.includes(workspace);
}

export function authFromSession(
  session: BrowserSession,
  requestedWorkspace?: string
): AuthOk {
  const workspace =
    requestedWorkspace && sessionAuthorizes(session, requestedWorkspace)
      ? requestedWorkspace
      : session.workspace;
  return {
    ok: true,
    actor: "session",
    keyWorkspace: workspace,
    authorizedWorkspaces: session.workspaces,
    canChooseWorkspace: session.canChooseWorkspace,
    // Browser session is read-only. Writes stay key-only (ANY-38).
    scope: "read",
  };
}

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function macEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function signSession(session: BrowserSession, secret = sessionSecret()): string {
  if (!secret) {
    throw new Error("session secret is required");
  }
  const payload = {
    v: SESSION_VERSION,
    actor: session.actor,
    workspace: session.workspace,
    workspaces: session.workspaces,
    choose: session.canChooseWorkspace,
    exp: session.exp,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signBody(body, secret)}`;
}

export function verifySession(
  token: string,
  secret = sessionSecret(),
  nowSeconds = Math.floor(Date.now() / 1000)
): BrowserSession | null {
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!body || !mac) return null;
  if (!macEqual(mac, signBody(body, secret))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      v?: unknown;
      actor?: unknown;
      workspace?: unknown;
      workspaces?: unknown;
      choose?: unknown;
      exp?: unknown;
    };
    if (parsed.v !== 1 && parsed.v !== SESSION_VERSION) return null;
    if (parsed.actor !== "env" && parsed.actor !== "hashed") return null;
    if (typeof parsed.workspace !== "string" || parsed.workspace.length === 0) {
      return null;
    }
    if (typeof parsed.exp !== "number" || parsed.exp <= nowSeconds) return null;
    const listed = Array.isArray(parsed.workspaces)
      ? parsed.workspaces.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    return {
      actor: parsed.actor,
      workspace: parsed.workspace,
      workspaces: uniqueWorkspaces(
        listed.length > 0 ? listed : [parsed.workspace]
      ),
      canChooseWorkspace: parsed.choose === true,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function parseNamedCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    const raw = part.slice(idx + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function readSessionToken(request: RequestLike): string | null {
  const header = request.headers.get("cookie") ?? request.headers.get("Cookie");
  if (!header) return null;
  return parseNamedCookie(header, SESSION_COOKIE_NAME);
}

export function readBrowserSession(request: RequestLike): BrowserSession | null {
  const token = readSessionToken(request);
  if (!token) return null;
  return verifySession(token);
}

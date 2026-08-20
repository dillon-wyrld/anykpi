import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DELETE as deleteSession,
  GET as getSession,
  POST as postSession,
} from "@/app/api/session/route";
import { GET as getDotplot } from "@/app/api/views/dotplot/route";
import { POST as postEvent } from "@/app/api/ingest/event/route";
import { POST as postSync } from "@/app/api/v1/sync/route";
import { SESSION_COOKIE_NAME } from "./session";

const ADMIN = "session-admin-key";
const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
  else process.env.ANYKPI_SECRET = originalSecret;
  vi.unstubAllEnvs();
});

function get(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

function post(url: string, body: unknown, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function setCookieHeader(response: Response): string {
  const list = response.headers.getSetCookie?.() ?? [];
  if (list.length > 0) return list.join("\n");
  return response.headers.get("set-cookie") ?? "";
}

function sessionCookiePair(response: Response): string {
  const header = setCookieHeader(response);
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(header);
  if (!match?.[1]) return "";
  return `${SESSION_COOKIE_NAME}=${match[1]}`;
}

describe("POST /api/session", () => {
  it("sets a signed httpOnly SameSite cookie that is not the raw key", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    process.env.ANYKPI_SECRET = "session-test-secret";
    vi.stubEnv("NODE_ENV", "test");

    const response = await postSession(
      post("http://localhost:3000/api/session", { key: ADMIN })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.authenticated).toBe(true);
    expect(JSON.stringify(body)).not.toContain(ADMIN);

    const setCookie = setCookieHeader(response);
    expect(setCookie).toMatch(new RegExp(SESSION_COOKIE_NAME));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toContain(ADMIN);
  });

  it("rejects a missing or wrong key with 401 and no session cookie", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const missing = await postSession(
      post("http://localhost:3000/api/session", {})
    );
    expect(missing.status).toBe(401);
    expect(setCookieHeader(missing)).not.toMatch(
      new RegExp(`${SESSION_COOKIE_NAME}=[^;]+`)
    );

    const wrong = await postSession(
      post("http://localhost:3000/api/session", { key: "no-match" })
    );
    expect(wrong.status).toBe(401);
  });
});

describe("browser session authorizes live reads only", () => {
  it("loads a live view with the cookie and keeps writes key-only", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    process.env.ANYKPI_SECRET = "session-test-secret";
    vi.stubEnv("NODE_ENV", "test");

    const login = await postSession(
      post("http://localhost:3000/api/session", { key: ADMIN })
    );
    expect(login.status).toBe(200);
    const cookie = sessionCookiePair(login);
    expect(cookie).toContain(SESSION_COOKIE_NAME);

    const status = await getSession(
      get("http://localhost:3000/api/session", { cookie })
    );
    expect(status.status).toBe(200);
    expect((await status.json()).authenticated).toBe(true);

    const live = await getDotplot(
      get("http://localhost:3000/api/views/dotplot?workspace=live", { cookie })
    );
    expect(live.status).toBe(200);

    const ingest = await postEvent(
      post(
        "http://localhost:3000/api/ingest/event",
        { userId: "u1", event: "song_played", workspaceId: "live" },
        { cookie }
      )
    );
    expect(ingest.status).toBe(401);

    const sync = await postSync(
      post("http://localhost:3000/api/v1/sync", { workspace: "live" }, { cookie })
    );
    expect(sync.status).toBe(401);

    const loggedOut = await deleteSession();
    expect(loggedOut.status).toBe(200);
    const cleared = setCookieHeader(loggedOut);
    expect(cleared).toMatch(/HttpOnly/i);
    expect(cleared).toMatch(/SameSite=Lax/i);
    expect(cleared).toMatch(/Max-Age=0/i);

    const after = await getDotplot(
      get("http://localhost:3000/api/views/dotplot?workspace=live")
    );
    expect(after.status).toBe(401);

    const demo = await getDotplot(
      get("http://localhost:3000/api/views/dotplot?workspace=demo")
    );
    expect(demo.status).toBe(200);
  });
});

import { createHmac } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseNamedCookie,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signSession,
  verifySession,
  type BrowserSession,
} from "./session";
import { stripKeyQueryParams } from "./session-url";

const SAMPLE: BrowserSession = {
  actor: "env",
  workspace: "live",
  workspaces: ["live"],
  canChooseWorkspace: true,
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe("session cookie options", () => {
  it("are httpOnly and SameSite=Lax", () => {
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("sets Secure only in production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(sessionCookieOptions().secure).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions().secure).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("sign and verify session", () => {
  const originalSecret = process.env.ANYKPI_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
    else process.env.ANYKPI_SECRET = originalSecret;
  });

  it("round-trips a payload and never embeds the API key", () => {
    const token = signSession(SAMPLE, "unit-secret");
    expect(token).not.toContain("unit-secret");
    expect(token).not.toContain("ak_");
    expect(verifySession(token, "unit-secret")).toEqual(SAMPLE);
  });

  it("rejects a tampered token", () => {
    const token = signSession(SAMPLE, "unit-secret");
    const [body, mac] = token.split(".");
    expect(verifySession(`${body}x.${mac}`, "unit-secret")).toBeNull();
    expect(verifySession(`${body}.${mac}x`, "unit-secret")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signSession({ ...SAMPLE, exp: 10 }, "unit-secret");
    expect(verifySession(token, "unit-secret", 11)).toBeNull();
  });

  it("accepts a v1 ticket as a single unlocked workspace", () => {
    const payload = {
      v: 1,
      actor: "hashed",
      workspace: "live",
      choose: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const mac = createHmac("sha256", "unit-secret").update(body).digest("base64url");
    expect(verifySession(`${body}.${mac}`, "unit-secret")).toEqual({
      actor: "hashed",
      workspace: "live",
      workspaces: ["live"],
      canChooseWorkspace: false,
      exp: payload.exp,
    });
  });
});

describe("parseNamedCookie", () => {
  it(`reads ${SESSION_COOKIE_NAME} among other cookies`, () => {
    expect(
      parseNamedCookie(
        `other=1; ${SESSION_COOKIE_NAME}=abc.def; theme=light`,
        SESSION_COOKIE_NAME
      )
    ).toBe("abc.def");
  });
});

describe("stripKeyQueryParams", () => {
  it("removes key-like query names so they never stay in a URL", () => {
    const params = new URLSearchParams(
      "workspace=live&view=dotplot&key=secret&api_key=also"
    );
    expect(stripKeyQueryParams(params)).toBe(true);
    expect(params.get("workspace")).toBe("live");
    expect(params.get("view")).toBe("dotplot");
    expect(params.has("key")).toBe(false);
    expect(params.has("api_key")).toBe(false);
  });

  it("leaves ordinary query strings alone", () => {
    const params = new URLSearchParams("workspace=live&view=dotplot");
    expect(stripKeyQueryParams(params)).toBe(false);
    expect(params.toString()).toBe("workspace=live&view=dotplot");
  });
});

describe("edge middleware + instrumentation", () => {
  it("stubs Node builtins so the Edge graph can compile", () => {
    const config = readFileSync(resolve(__dirname, "../../next.config.ts"), "utf8");
    expect(config).toMatch(/nextRuntime === "edge"/);
    expect(config).toMatch(/fs:\s*false/);
    expect(config).toMatch(/path:\s*false/);
    expect(config).toMatch(/crypto:\s*false/);
    expect(config).toMatch(/net:\s*false/);
    expect(config).toMatch(/tls:\s*false/);
    expect(config).toMatch(/stream:\s*false/);
    expect(config).toMatch(/os:\s*false/);
    expect(config).toMatch(/perf_hooks:\s*false/);
  });
});

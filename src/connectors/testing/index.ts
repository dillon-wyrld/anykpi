/**
 * Recorded-fixture HTTP harness for connectors.
 *
 * Replays committed request/response pairs so connector tests stay offline.
 * Source-agnostic: match on method + URL, return the recorded body.
 * See RECORDING.md for how to capture a new suite.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type HttpFixture = {
  name?: string;
  request: {
    method?: string;
    url?: string;
    urlIncludes?: string;
    /** RegExp source, matched against the full request URL. */
    urlPattern?: string;
  };
  response: {
    status?: number;
    headers?: Record<string, string>;
    body: unknown;
  };
};

export type FixtureSuite = {
  source: string;
  description?: string;
  fixtures: HttpFixture[];
};

export type FixtureCall = {
  method: string;
  url: string;
};

export type InstalledFetch = {
  restore: () => void;
  calls: FixtureCall[];
  recorded: HttpFixture[];
};

const RECORD_ENV = "ANYKPI_RECORD_FIXTURES";

export function isRecording(): boolean {
  return process.env[RECORD_ENV] === "1";
}

export function loadFixtureSuite(dir: string): FixtureSuite {
  const suitePath = join(dir, "suite.json");
  if (!existsSync(suitePath)) {
    throw new Error(`No suite.json in ${dir}`);
  }
  const parsed = JSON.parse(readFileSync(suitePath, "utf8")) as FixtureSuite;
  if (!Array.isArray(parsed.fixtures)) {
    throw new Error(`suite.json in ${dir} must include a fixtures array`);
  }
  return parsed;
}

export function matchFixture(
  fixture: HttpFixture,
  method: string,
  url: string
): boolean {
  const wantMethod = (fixture.request.method ?? "GET").toUpperCase();
  if (wantMethod !== method.toUpperCase()) {
    return false;
  }
  if (fixture.request.url && fixture.request.url !== url) {
    return false;
  }
  if (fixture.request.urlIncludes && !url.includes(fixture.request.urlIncludes)) {
    return false;
  }
  if (fixture.request.urlPattern) {
    const re = new RegExp(fixture.request.urlPattern);
    if (!re.test(url)) {
      return false;
    }
  }
  const hasLocator =
    Boolean(fixture.request.url) ||
    Boolean(fixture.request.urlIncludes) ||
    Boolean(fixture.request.urlPattern);
  return hasLocator;
}

export function fixtureToResponse(response: HttpFixture["response"]): Response {
  const status = response.status ?? 200;
  const headers = new Headers(response.headers);
  const body = response.body;
  if (typeof body === "string") {
    if (!headers.has("content-type")) {
      headers.set("content-type", "text/plain; charset=utf-8");
    }
    return new Response(body, { status, headers });
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL)) {
    return input.method.toUpperCase();
  }
  return "GET";
}

export function installFixtureFetch(
  fixtures: HttpFixture[] | FixtureSuite
): InstalledFetch {
  const list = Array.isArray(fixtures) ? fixtures : fixtures.fixtures;
  const previous = globalThis.fetch;
  const calls: FixtureCall[] = [];

  const mocked: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    calls.push({ method, url });

    const match = list.find((fixture) => matchFixture(fixture, method, url));
    if (!match) {
      const known = list
        .map((f) => {
          const loc =
            f.request.url ?? f.request.urlIncludes ?? f.request.urlPattern ?? "?";
          return `${(f.request.method ?? "GET").toUpperCase()} ${loc}`;
        })
        .join(", ");
      throw new Error(
        `No HTTP fixture for ${method} ${url}. Harness is offline. Known: ${known || "(none)"}`
      );
    }
    return fixtureToResponse(match.response);
  };

  globalThis.fetch = mocked;

  return {
    restore() {
      globalThis.fetch = previous;
    },
    calls,
    recorded: [],
  };
}

function sanitizeRecordedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|secret|token|auth|password/i.test(key)) {
        parsed.searchParams.set(key, "REDACTED");
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function writeFixtureSuite(dir: string, suite: FixtureSuite): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "suite.json"), `${JSON.stringify(suite, null, 2)}\n`);
}

export function installRecordingFetch(outDir: string, source: string): InstalledFetch {
  const previous = globalThis.fetch;
  const calls: FixtureCall[] = [];
  const recorded: HttpFixture[] = [];

  const wrapped: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    calls.push({ method, url });
    const res = await previous(input, init);
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    let body: unknown = text;
    if (contentType.includes("json")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    recorded.push({
      name: `exchange-${recorded.length + 1}`,
      request: { method, url: sanitizeRecordedUrl(url) },
      response: { status: res.status, body },
    });
    return new Response(text, { status: res.status, headers: res.headers });
  };

  globalThis.fetch = wrapped;

  return {
    restore() {
      writeFixtureSuite(outDir, { source, fixtures: recorded });
      globalThis.fetch = previous;
    },
    calls,
    recorded,
  };
}

/**
 * Replay fixtures, or record live traffic when ANYKPI_RECORD_FIXTURES=1.
 */
export function installConnectorFetch(opts: {
  fixtures: HttpFixture[] | FixtureSuite;
  recordDir: string;
  source: string;
}): InstalledFetch {
  if (isRecording()) {
    return installRecordingFetch(opts.recordDir, opts.source);
  }
  return installFixtureFetch(opts.fixtures);
}

export function fixtureDir(...segments: string[]): string {
  return join(__dirname, "fixtures", ...segments);
}

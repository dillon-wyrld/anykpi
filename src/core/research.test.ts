import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { GET as getPmf, POST as postPmf } from "@/app/api/views/pmf/route";
import {
  approveOutgoingFields,
  buildResearchQuery,
  buildResearchUrl,
  discloseResearch,
  listCachedResearch,
  listOutgoingFields,
  parseOpenSearchPayload,
  researchCachePath,
  runResearch,
  type ResearchSubject,
} from "./research";

const WS = "research-test";
const CACHE_DIR = mkdtempSync(join(tmpdir(), "anykpi-research-"));

function subject(overrides: Partial<ResearchSubject> = {}): ResearchSubject {
  return {
    personId: "p-river",
    name: "River",
    country: "GB",
    email: "river@hidden.test",
    ...overrides,
  };
}

function stubFetch(payload: unknown = openSearch("River")) {
  return vi.fn(async () => {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function openSearch(title: string) {
  return [
    title,
    [title],
    [`A public page about ${title}`],
    [`https://example.test/wiki/${encodeURIComponent(title)}`],
  ];
}

function cachePath(name: string): string {
  return join(CACHE_DIR, `${name}.json`);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.personId, "p-river"));
  const path = researchCachePath();
  if (existsSync(path)) unlinkSync(path);
});

describe("disclosure lists outgoing fields verbatim", () => {
  it("lists name and country, never email or person id", () => {
    const disclosure = discloseResearch(subject());
    expect(disclosure.personId).toBe("p-river");
    expect(disclosure.outgoing).toEqual([
      { field: "name", value: "River" },
      { field: "country", value: "GB" },
    ]);
    const blob = JSON.stringify(disclosure.outgoing);
    expect(blob).toContain("River");
    expect(blob).toContain("GB");
    expect(blob).not.toContain("river@hidden.test");
    expect(blob).not.toContain("p-river");
    expect(listOutgoingFields(subject()).map((f) => f.field)).toEqual([
      "name",
      "country",
    ]);
  });

  it("omits a missing country and still lists the name verbatim", () => {
    expect(listOutgoingFields(subject({ country: null }))).toEqual([
      { field: "name", value: "River" },
    ]);
  });

  it("rejects email, extras, and mismatched values — no query is built", () => {
    const river = subject();
    expect(
      approveOutgoingFields(river, [
        { field: "name", value: "River" },
        { field: "email", value: "river@hidden.test" },
      ])
    ).toBeNull();
    expect(
      approveOutgoingFields(river, [{ field: "name", value: "Someone Else" }])
    ).toBeNull();
    expect(approveOutgoingFields(river, [])).toBeNull();
    expect(
      approveOutgoingFields(river, [{ field: "country", value: "GB" }])
    ).toBeNull();
  });
});

describe("research runs only from the explicit action", () => {
  it("stubs fetch and never calls it from disclosure or a cache list", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("egress: research must not run until the founder approves");
    });
    vi.stubGlobal("fetch", fetchMock);

    discloseResearch(subject());
    listOutgoingFields(subject());
    listCachedResearch(WS, cachePath("idle"));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch without an approved field list", async () => {
    const fetchMock = stubFetch();
    const path = cachePath("denied");

    const empty = await runResearch({
      workspace: WS,
      subject: subject(),
      approvedFields: [],
      fetch: fetchMock,
      cachePath: path,
    });
    expect(empty.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const mismatched = await runResearch({
      workspace: WS,
      subject: subject(),
      approvedFields: [{ field: "name", value: "Not River" }],
      fetch: fetchMock,
      cachePath: path,
    });
    expect(mismatched.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once after approval, then serves the local cache", async () => {
    const fetchMock = stubFetch();
    const path = cachePath("hit");
    const approved = listOutgoingFields(subject());

    const first = await runResearch({
      workspace: WS,
      subject: subject(),
      approvedFields: approved,
      fetch: fetchMock,
      cachePath: path,
      now: new Date("2026-08-19T12:00:00.000Z"),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result.cached).toBe(false);
    expect(first.result.query).toBe("River GB");
    expect(first.result.outgoing).toEqual(approved);
    expect(first.result.claims[0]?.title).toContain("River");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = String(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined)?.[0]
    );
    expect(url).toBe(buildResearchUrl("River GB"));
    expect(url).toContain("search=River+GB");
    expect(url).not.toContain("hidden.test");
    expect(url).not.toContain("p-river");
    expect(buildResearchQuery(approved)).toBe("River GB");

    const second = await runResearch({
      workspace: WS,
      subject: subject(),
      approvedFields: approved,
      fetch: fetchMock,
      cachePath: path,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const disk = JSON.parse(readFileSync(path, "utf8")) as {
      entries: Record<string, { personId: string }>;
    };
    expect(Object.values(disk.entries)[0]?.personId).toBe("p-river");
    expect(listCachedResearch(WS, path)).toHaveLength(1);
  });
});

describe("public source parse", () => {
  it("reads OpenSearch titles into claims", () => {
    const claims = parseOpenSearchPayload(openSearch("River"));
    expect(claims).toHaveLength(1);
    expect(claims[0]?.source).toBe("example.test");
    expect(claims[0]?.url).toContain("River");
  });
});

describe("GET /api/views/pmf never egresses", () => {
  it("stubs fetch and loads the view without a query", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("egress: loading PMF must not research");
    });
    vi.stubGlobal("fetch", fetchMock);

    await db.insert(schema.users).values({
      personId: "p-river",
      name: "River",
      country: "GB",
      email: "river@hidden.test",
      emoji: "🌊",
      workspaceId: "demo",
    });

    const response = await getPmf(
      new NextRequest("http://localhost:3000/api/views/pmf?workspace=demo")
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      candidates: { personId: string; outgoing: { field: string; value: string }[] }[];
      runs: unknown[];
    };
    const river = body.candidates.find((c) => c.personId === "p-river");
    expect(river?.outgoing).toEqual([
      { field: "name", value: "River" },
      { field: "country", value: "GB" },
    ]);
    expect(JSON.stringify(river?.outgoing)).not.toContain("hidden.test");
    expect(fetchMock).not.toHaveBeenCalled();

    const disclosed = await getPmf(
      new NextRequest(
        "http://localhost:3000/api/views/pmf?workspace=demo&user=p-river"
      )
    );
    expect(disclosed.status).toBe(200);
    const detail = (await disclosed.json()) as {
      disclosure: { outgoing: { field: string; value: string }[] };
    };
    expect(detail.disclosure.outgoing).toEqual([
      { field: "name", value: "River" },
      { field: "country", value: "GB" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/views/pmf is the explicit action", () => {
  it("refuses without approved fields and does not fetch", async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal("fetch", fetchMock);

    await db.insert(schema.users).values({
      personId: "p-river",
      name: "River",
      country: "GB",
      workspaceId: "demo",
    });

    const denied = await postPmf(
      new NextRequest("http://localhost:3000/api/views/pmf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: "demo", personId: "p-river", approvedFields: [] }),
      })
    );
    expect(denied.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs research only after the founder posts the disclosed fields", async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal("fetch", fetchMock);

    await db.insert(schema.users).values({
      personId: "p-river",
      name: "River",
      country: "GB",
      emoji: "🌊",
      platform: "web",
      workspaceId: "demo",
    });

    const approved = [
      { field: "name", value: "River" },
      { field: "country", value: "GB" },
    ];
    const response = await postPmf(
      new NextRequest("http://localhost:3000/api/views/pmf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace: "demo",
          personId: "p-river",
          approvedFields: approved,
        }),
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      run: { people: { name: string; claims: { title: string }[] }[] };
    };
    expect(body.run.people[0]?.name).toBe("River");
    expect(body.run.people[0]?.claims[0]?.title).toContain("River");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

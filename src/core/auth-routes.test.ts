import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getUsers } from "@/app/api/v1/users/route";
import { POST as postEvent } from "@/app/api/ingest/event/route";
import { GET as getDotplot } from "@/app/api/views/dotplot/route";
import { GET as getCohorts } from "@/app/api/views/cohorts/route";
import { GET as getPerson } from "@/app/api/views/person/route";

const originalKey = process.env.ANYKPI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.ANYKPI_API_KEY;
  } else {
    process.env.ANYKPI_API_KEY = originalKey;
  }
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

describe("API auth routes", () => {
  it("unauthenticated GET /api/v1/users?workspace=live → 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getUsers(
      get("http://localhost:3000/api/v1/users?workspace=live")
    );
    expect(response.status).toBe(401);
  });

  it("unauthenticated POST /api/ingest/event → 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await postEvent(
      post("http://localhost:3000/api/ingest/event", {
        userId: "u1",
        event: "song_played",
        workspaceId: "live",
      })
    );
    expect(response.status).toBe(401);
  });

  it("demo GET views still 200", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const dotplot = await getDotplot(
      get("http://localhost:3000/api/views/dotplot?workspace=demo")
    );
    expect(dotplot.status).toBe(200);

    const cohorts = await getCohorts(
      get("http://localhost:3000/api/views/cohorts?workspace=demo")
    );
    expect(cohorts.status).toBe(200);

    const person = await getPerson(
      get("http://localhost:3000/api/views/person?workspace=demo&user=p1")
    );
    expect([200, 404]).toContain(person.status);
  });

  it("unauthenticated GET /api/views/person?workspace=live → 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getPerson(
      get("http://localhost:3000/api/views/person?workspace=live&user=p1")
    );
    expect(response.status).toBe(401);
  });

  it("GET /api/views/person without user → 400", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getPerson(
      get("http://localhost:3000/api/views/person?workspace=demo")
    );
    expect(response.status).toBe(400);
  });
});

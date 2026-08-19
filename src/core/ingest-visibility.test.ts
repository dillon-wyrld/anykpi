import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as postEvent } from "@/app/api/ingest/event/route";
import { GET as getUsers } from "@/app/api/v1/users/route";

const ADMIN = "admin-secret";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
});

describe("track is visible via users API", () => {
  it("POST /api/ingest/event creates a user that GET /api/v1/users returns", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const userId = `ingest-vis-${Date.now()}`;
    const platform = `plat-${userId}`;

    const posted = await postEvent(
      new NextRequest("http://localhost:3000/api/ingest/event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
          "x-api-key": ADMIN,
        },
        body: JSON.stringify({
          userId,
          eventName: "cli_smoke_event",
          workspaceId: "demo",
          properties: { name: "Ingest Visible", platform },
        }),
      })
    );
    expect(posted.status).toBe(200);

    const listed = await getUsers(
      new NextRequest(
        `http://localhost:3000/api/v1/users?workspace=demo&platform=${encodeURIComponent(platform)}`
      )
    );
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.users.map((user: { personId: string }) => user.personId)).toContain(
      `person_${userId}`
    );
  });
});

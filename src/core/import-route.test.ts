import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postImport } from "@/app/api/v1/import/route";
import { db } from "./db";
import * as schema from "./schema";
import { readFileSync } from "fs";
import { resolve } from "path";

const ADMIN = "import-route-admin";
const WS = "import-route";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
});

function asAdmin(body: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
  vi.stubEnv("NODE_ENV", "test");
  return new NextRequest("http://localhost:3000/api/v1/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/import", () => {
  it("rejects unauthenticated writes with 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const res = await postImport(
      new NextRequest("http://localhost:3000/api/v1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csv: "person_id,name\na,Ada\n",
          kind: "users",
          workspaceId: "demo",
        }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns a column-mapping preview without writing", async () => {
    const csv = readFileSync(
      resolve(__dirname, "../../tests/fixtures/import/events.csv"),
      "utf8"
    );
    const res = await postImport(
      asAdmin({ csv, kind: "events", workspaceId: WS, preview: true })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("events");
    expect(body.columns).toContain("event_name");
    expect(body.mapping.event_name).toBe("eventName");
    expect(body.rowCount).toBe(3);

    const activity = await db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .all();
    expect(activity).toHaveLength(0);
  });

  it("imports events when keyed and reports line numbers for corrupt rows", async () => {
    const good = readFileSync(
      resolve(__dirname, "../../tests/fixtures/import/events.csv"),
      "utf8"
    );
    const imported = await postImport(
      asAdmin({ csv: good, kind: "events", workspaceId: WS })
    );
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({
      workspaceId: WS,
      kind: "events",
      imported: 3,
      skipped: 0,
    });

    const corrupt = readFileSync(
      resolve(__dirname, "../../tests/fixtures/import/corrupt-events.csv"),
      "utf8"
    );
    const failed = await postImport(
      asAdmin({ csv: corrupt, kind: "events", workspaceId: WS })
    );
    expect(failed.status).toBe(400);
    const body = await failed.json();
    expect(body.error).toMatch(/line 3/);
    expect(body.errors).toEqual([{ line: 3, message: "invalid timestamp" }]);
  });
});

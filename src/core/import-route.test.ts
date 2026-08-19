import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postImport } from "@/app/api/v1/import/route";
import { POST as postConnect } from "@/app/api/v1/connect/route";
import { db } from "./db";
import * as schema from "./schema";
import { loadSourceCiphertext, loadSourceConfig } from "./sources";
import { CSV_SOURCE } from "./csv-import";
import { readFileSync } from "fs";
import { resolve } from "path";

const ADMIN = "import-route-admin";
const WS = "import-route";
const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
  else process.env.ANYKPI_SECRET = originalSecret;
  vi.unstubAllEnvs();
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, WS));
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

    const stored = await loadSourceConfig(WS, CSV_SOURCE);
    expect(stored?.kind).toBe("events");
    const ciphertext = await loadSourceCiphertext(WS, CSV_SOURCE);
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain("event_name");
  });

  it("returns 503 when ANYKPI_SECRET is unset", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    delete process.env.ANYKPI_SECRET;
    vi.stubEnv("NODE_ENV", "test");

    const res = await postImport(
      new NextRequest("http://localhost:3000/api/v1/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          csv: "person_id,name\na,Ada\n",
          kind: "users",
          workspaceId: WS,
        }),
      })
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/ANYKPI_SECRET/);
  });

  it("reuses mapping saved by POST /api/v1/connect", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
    vi.stubEnv("NODE_ENV", "test");

    const connected = await postConnect(
      new NextRequest("http://localhost:3000/api/v1/connect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          source: "csv",
          workspaceId: WS,
          credentials: {
            kind: "events",
            mapping: JSON.stringify({
              person_id: "personId",
              timestamp: "timestamp",
              event_name: "eventName",
              platform: "platform",
              external_id: "externalId",
            }),
          },
        }),
      })
    );
    expect(connected.status).toBe(201);

    const csv = readFileSync(
      resolve(__dirname, "../../tests/fixtures/import/events.csv"),
      "utf8"
    );
    const imported = await postImport(asAdmin({ csv, workspaceId: WS }));
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({
      kind: "events",
      imported: 3,
    });
  });
});

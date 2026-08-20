import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getExport } from "@/app/api/v1/export/route";
import { db } from "./db";
import * as schema from "./schema";
import { CONNECTOR_RESTORE_NOTE } from "./export";
import { runCsvImport } from "./csv-import";

const ADMIN = "export-route-admin";
const WS = "export-route";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
});

function get(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

describe("GET /api/v1/export", () => {
  it("demo remains readable without a key", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getExport(
      get("http://localhost:3000/api/v1/export?workspace=demo")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workspaceId).toBe("demo");
    expect(body.format).toBe("json");
    expect(body.restore.connectorReadModels).toBe(CONNECTOR_RESTORE_NOTE);
    expect(Array.isArray(body.users)).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.readModels).toBeDefined();
    expect(body.view_url).toMatch(/view=dotplot/);
  });

  it("live requires an API key (401)", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getExport(
      get("http://localhost:3000/api/v1/export?workspace=live")
    );
    expect(response.status).toBe(401);
  });

  it("returns csv files that name users and events", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const imported = await runCsvImport({
      csv: "personId,name\nroute_ada,Ada\n",
      kind: "users",
      workspaceId: WS,
    });
    expect(imported.status).toBe("ok");

    const response = await getExport(
      get(`http://localhost:3000/api/v1/export?workspace=${WS}&format=csv`, {
        authorization: `Bearer ${ADMIN}`,
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.format).toBe("csv");
    expect(body.files["users.csv"]).toMatch(/route_ada/);
    expect(body.files["events.csv"]).toMatch(/^personId,timestamp,eventName/);
    expect(body.restore.usersAndEvents).toMatch(/anykpi import/);
  });

  it("rejects an unknown format", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getExport(
      get("http://localhost:3000/api/v1/export?workspace=demo&format=xml")
    );
    expect(response.status).toBe(400);
  });
});

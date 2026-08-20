import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { POST as postSession } from "@/app/api/session/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { GET as getUsers } from "@/app/api/v1/users/route";
import { DELETE as deleteUser } from "@/app/api/v1/users/[id]/route";
import { GET as getAudit } from "@/app/api/v1/audit/route";
import { POST as createKey } from "@/app/api/v1/keys/route";
import { listConnectors, sync } from "@/connectors";
import { SESSION_COOKIE_NAME } from "./session";
import { AUDIT_ACTIONS } from "./audit";
import { db } from "./db";
import * as schema from "./schema";
import { runCsvImport } from "./csv-import";
import { runIngestBatch } from "./ingest-batch";
import { saveSourceConfig } from "./sources";
import { loadPersonPanel } from "./views/person";
import { withOfflineSuite } from "@/connectors/testing/offline";

const ADMIN = "users-delete-admin";
const WS = "users-delete";
const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;

const SOURCE_SUITES: Record<string, string[]> = {
  posthog: ["posthog"],
  mixpanel: ["mixpanel"],
  amplitude: ["amplitude"],
  stripe: ["stripe", "happy"],
  revenuecat: ["revenuecat", "happy"],
  mercury: ["mercury", "happy"],
  ics: ["ics"],
  github: ["github", "happy"],
};

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
  else process.env.ANYKPI_SECRET = originalSecret;
  vi.unstubAllEnvs();
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.personRevenue).where(eq(schema.personRevenue.workspaceId, WS));
  await db
    .delete(schema.subscriptionEvents)
    .where(eq(schema.subscriptionEvents.workspaceId, WS));
  await db.delete(schema.seats).where(eq(schema.seats.workspaceId, WS));
  await db.delete(schema.outreach).where(eq(schema.outreach.workspaceId, WS));
  await db.delete(schema.tombstones).where(eq(schema.tombstones.workspaceId, WS));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, WS));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, WS));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, WS));
});

function asAdmin(url: string, method: string, body?: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  vi.stubEnv("NODE_ENV", "test");
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedPerson(personId = "person_erase-me") {
  await db.insert(schema.users).values({
    personId,
    name: "Ada",
    email: "ada@example.com",
    workspaceId: WS,
    platform: "ios",
  });
  await db.insert(schema.activity).values({
    personId,
    timestamp: new Date("2026-03-01T00:00:00.000Z"),
    eventName: "song_played",
    eventClass: "core",
    platform: "ios",
    externalId: `evt-${personId}`,
    workspaceId: WS,
  });
  await db.insert(schema.personRevenue).values({
    personId,
    accountId: personId,
    status: "active",
    plan: "pro",
    mrr: 12,
    workspaceId: WS,
  });
  return personId;
}

async function listPersonIds() {
  const users = await db
    .select({ personId: schema.users.personId })
    .from(schema.users)
    .where(eq(schema.users.workspaceId, WS))
    .all();
  return users.map((row) => row.personId);
}

async function syncEverySource() {
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  process.env.POSTHOG_API_KEY = "phx_test";
  process.env.POSTHOG_PROJECT_ID = "proj_fixture";
  process.env.POSTHOG_HOST = "https://app.posthog.com";
  process.env.MIXPANEL_PROJECT_ID = "proj_fixture";
  process.env.MIXPANEL_API_SECRET = "mp_test";
  process.env.AMPLITUDE_API_KEY = "amp_test";
  process.env.AMPLITUDE_SECRET_KEY = "amp_secret_test";

  await saveSourceConfig(WS, "stripe", {
    apiKey: "rk_test_fixture_restricted",
  });
  await saveSourceConfig(WS, "revenuecat", {
    apiKey: "sk_test_fixture_secret",
    projectId: "proj_fixture",
  });
  await saveSourceConfig(WS, "mercury", {
    apiKey: "secret-token:mercury_test_fixture",
  });
  await saveSourceConfig(WS, "ics", {
    icsUrl: "https://cal.example.test/private/calendar.ics",
  });
  await saveSourceConfig(WS, "github", {
    token: "ghp_test_fixture_token",
    repo: "fixture-org/fixture-app",
  });

  const sources = listConnectors().map((connector) => connector.source);
  expect(sources.sort()).toEqual(Object.keys(SOURCE_SUITES).sort());

  for (const source of sources) {
    const segments = SOURCE_SUITES[source];
    if (!segments) throw new Error(`missing fixture suite for ${source}`);
    await withOfflineSuite(source, segments, async () => {
      await sync(source, WS);
    });
  }
}

describe("DELETE /api/v1/users/:id", () => {
  it("purges the person, write models, and records an audit row", async () => {
    const personId = await seedPerson();
    const res = await deleteUser(
      asAdmin(`http://localhost:3000/api/v1/users/${personId}?workspace=${WS}`, "DELETE"),
      { params: Promise.resolve({ id: personId }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: true,
      personId,
      workspace: WS,
    });

    expect(await listPersonIds()).not.toContain(personId);
    const activity = await db
      .select()
      .from(schema.activity)
      .where(
        and(eq(schema.activity.workspaceId, WS), eq(schema.activity.personId, personId))
      )
      .all();
    expect(activity).toHaveLength(0);
    const revenue = await db
      .select()
      .from(schema.personRevenue)
      .where(
        and(
          eq(schema.personRevenue.workspaceId, WS),
          eq(schema.personRevenue.personId, personId)
        )
      )
      .all();
    expect(revenue).toHaveLength(0);

    const stones = await db
      .select()
      .from(schema.tombstones)
      .where(eq(schema.tombstones.workspaceId, WS))
      .all();
    expect(stones.map((row) => row.externalId)).toEqual(
      expect.arrayContaining([personId, "erase-me", "ada@example.com"])
    );

    const audit = await getAudit(
      asAdmin(`http://localhost:3000/api/v1/audit?workspace=${WS}`, "GET")
    );
    const body = (await audit.json()) as {
      entries: Array<{ actor: string; action: string; subject: string }>;
    };
    expect(body.entries).toContainEqual(
      expect.objectContaining({
        actor: "env",
        action: AUDIT_ACTIONS.usersDelete,
        subject: personId,
      })
    );
  });

  it("is absent from the users API, person panel, and MCP after delete", async () => {
    const personId = await seedPerson();
    const deleted = await deleteUser(
      asAdmin(`http://localhost:3000/api/v1/users/${personId}?workspace=${WS}`, "DELETE"),
      { params: Promise.resolve({ id: personId }) }
    );
    expect(deleted.status).toBe(200);

    const listed = await getUsers(
      asAdmin(`http://localhost:3000/api/v1/users?workspace=${WS}`, "GET")
    );
    expect(listed.status).toBe(200);
    const users = (await listed.json()) as { users: { personId: string }[] };
    expect(users.users.map((user) => user.personId)).not.toContain(personId);

    expect(await loadPersonPanel(WS, personId)).toBeNull();

    const mcp = await postMcp(
      asAdmin("http://localhost:3000/api/mcp", "POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "query_users",
          arguments: { workspace: WS, limit: 50 },
        },
      })
    );
    const mcpBody = (await mcp.json()) as {
      result?: { content?: { text?: string }[] };
    };
    const parsed = JSON.parse(mcpBody.result?.content?.[0]?.text ?? "{}") as {
      users: { personId: string }[];
    };
    expect(parsed.users.map((user) => user.personId)).not.toContain(personId);
  });

  it("refuses a browser-session DELETE with 403", async () => {
    const personId = await seedPerson();
    process.env.ANYKPI_API_KEY = ADMIN;
    process.env.ANYKPI_SECRET = "users-delete-session";
    vi.stubEnv("NODE_ENV", "test");

    const login = await postSession(
      new NextRequest("http://localhost:3000/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: ADMIN }),
      })
    );
    expect(login.status).toBe(200);
    const setCookie = login.headers.getSetCookie?.()[0] ?? login.headers.get("set-cookie") ?? "";
    const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookie);
    expect(match?.[1]).toBeTruthy();

    const res = await deleteUser(
      new NextRequest(
        `http://localhost:3000/api/v1/users/${personId}?workspace=${WS}`,
        {
          method: "DELETE",
          headers: { cookie: `${SESSION_COOKIE_NAME}=${match?.[1]}` },
        }
      ),
      { params: Promise.resolve({ id: personId }) }
    );
    expect(res.status).toBe(403);
    expect(await listPersonIds()).toContain(personId);
  });

  it("rejects a read key with 403 and no key with 401", async () => {
    const personId = await seedPerson();
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const minted = await createKey(
      asAdmin("http://localhost:3000/api/v1/keys", "POST", {
        name: "reader",
        workspace: WS,
      })
    );
    const { key } = (await minted.json()) as { key: string };

    const read = await deleteUser(
      new NextRequest(
        `http://localhost:3000/api/v1/users/${personId}?workspace=${WS}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${key}` },
        }
      ),
      { params: Promise.resolve({ id: personId }) }
    );
    expect(read.status).toBe(403);

    const anon = await deleteUser(
      new NextRequest(
        `http://localhost:3000/api/v1/users/${personId}?workspace=${WS}`,
        { method: "DELETE" }
      ),
      { params: Promise.resolve({ id: personId }) }
    );
    expect(anon.status).toBe(401);
  });

  it("does not resurrect after a full re-sync of every connected source", async () => {
    await syncEverySource();

    const beforeUsers = await db
      .select({ personId: schema.users.personId })
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    const beforeRevenue = await db
      .select({ personId: schema.personRevenue.personId })
      .from(schema.personRevenue)
      .where(eq(schema.personRevenue.workspaceId, WS))
      .all();
    const personIds = [
      ...new Set([
        ...beforeUsers.map((row) => row.personId),
        ...beforeRevenue.map((row) => row.personId),
      ]),
    ];
    expect(personIds.length).toBeGreaterThan(0);

    for (const personId of personIds) {
      const res = await deleteUser(
        asAdmin(
          `http://localhost:3000/api/v1/users/${encodeURIComponent(personId)}?workspace=${WS}`,
          "DELETE"
        ),
        { params: Promise.resolve({ id: personId }) }
      );
      expect(res.status).toBe(200);
    }

    await syncEverySource();

    const afterUsers = await db
      .select({ personId: schema.users.personId })
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    const afterRevenue = await db
      .select({ personId: schema.personRevenue.personId })
      .from(schema.personRevenue)
      .where(eq(schema.personRevenue.workspaceId, WS))
      .all();
    const afterActivity = await db
      .select({ personId: schema.activity.personId })
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .all();

    for (const personId of personIds) {
      expect(afterUsers.map((row) => row.personId)).not.toContain(personId);
      expect(afterRevenue.map((row) => row.personId)).not.toContain(personId);
      expect(afterActivity.map((row) => row.personId)).not.toContain(personId);
    }
  });

  it("CSV import and batch ingest skip tombstoned people", async () => {
    const personId = await seedPerson("person_csv-batch");
    const deleted = await deleteUser(
      asAdmin(`http://localhost:3000/api/v1/users/${personId}?workspace=${WS}`, "DELETE"),
      { params: Promise.resolve({ id: personId }) }
    );
    expect(deleted.status).toBe(200);

    const imported = await runCsvImport({
      workspaceId: WS,
      kind: "users",
      csv: "person_id,name,email\nperson_csv-batch,Ada,ada@example.com\n",
    });
    expect(imported.status).toBe("ok");

    const events = await runCsvImport({
      workspaceId: WS,
      kind: "events",
      csv: "person_id,timestamp,event_name\nperson_csv-batch,2026-03-02T00:00:00.000Z,song_played\n",
    });
    expect(events.status).toBe("ok");

    runIngestBatch(WS, [
      {
        userId: "csv-batch",
        eventName: "song_played",
        timestamp: "2026-03-03T00:00:00.000Z",
        idempotencyKey: "tombstone-batch-1",
      },
    ]);

    expect(await listPersonIds()).not.toContain(personId);
    const activity = await db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .all();
    expect(activity).toHaveLength(0);
  });
});

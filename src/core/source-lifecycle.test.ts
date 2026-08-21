import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  DELETE as deleteConnect,
  PATCH as patchConnect,
  POST as postConnect,
} from "@/app/api/v1/connect/route";
import { ConnectorHealthList } from "@/app/connect/ConnectorHealthPanel";
import { presentConnectorHealth } from "@/core/connector-health";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import {
  clearSourceError,
  disconnectSource,
  loadSourceCiphertext,
  loadSourceConfig,
  pauseSource,
  resumeSource,
  saveSourceConfig,
} from "@/core/sources";
import { listScheduledTargets } from "@/core/scheduler";
import { upsertSyncState } from "@/core/upsert";
import type { SyncHealth } from "@/core/contracts";

const ADMIN = "source-lifecycle-admin";
const WS = "source-lifecycle";
const SECRET = "ics://source-lifecycle-must-stay-encrypted";
const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;
const originalMercury = process.env.MERCURY_API_KEY;

afterEach(async () => {
  restoreEnv("ANYKPI_API_KEY", originalKey);
  restoreEnv("ANYKPI_SECRET", originalSecret);
  restoreEnv("MERCURY_API_KEY", originalMercury);
  vi.unstubAllEnvs();
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, WS));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
  await db.delete(schema.calEvents).where(eq(schema.calEvents.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, WS));
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function asAdmin(method: string, body: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  vi.stubEnv("NODE_ENV", "test");
  return new NextRequest("http://localhost:3000/api/v1/connect", {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
    },
    body: JSON.stringify(body),
  });
}

async function seedConnectedIcs() {
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  await saveSourceConfig(WS, "ics", { icsUrl: SECRET });
  await upsertSyncState({
    source: "ics",
    sourceName: "Calendar",
    lastSync: new Date("2026-08-20T06:00:00.000Z"),
    status: "success",
    workspaceId: WS,
  });
  await db.insert(schema.calEvents).values({
    source: "ics",
    sourceName: "Calendar",
    sourceColor: "#2563eb",
    type: "comms",
    emoji: "📅",
    title: "Launch week",
    badge: "all day",
    eventDate: new Date("2026-08-21T00:00:00.000Z"),
    isFuture: false,
    workspaceId: WS,
  });
  await db.insert(schema.users).values({
    personId: `${WS}-ada`,
    name: "Ada",
    workspaceId: WS,
  });
}

describe("disconnect keeps synced data with provenance", () => {
  it("deletes credential + sync state and leaves tagged rows", async () => {
    await seedConnectedIcs();

    const result = await disconnectSource(WS, "ics");
    expect(result).toEqual({ disconnected: true });
    expect(await loadSourceCiphertext(WS, "ics")).toBeNull();
    expect(await loadSourceConfig(WS, "ics")).toBeNull();

    const states = await db
      .select()
      .from(schema.syncState)
      .where(eq(schema.syncState.workspaceId, WS))
      .all();
    expect(states).toEqual([]);

    const events = await db
      .select()
      .from(schema.calEvents)
      .where(eq(schema.calEvents.workspaceId, WS))
      .all();
    expect(events).toEqual([
      expect.objectContaining({ source: "ics", title: "Launch week" }),
    ]);
    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    expect(users.map((row) => row.personId)).toEqual([`${WS}-ada`]);
  });
});

describe("pause skips scheduling; resume restores config", () => {
  it("keeps encrypted config while the scheduler omits the source", async () => {
    process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
    delete process.env.MERCURY_API_KEY;
    await saveSourceConfig(WS, "ics", { icsUrl: SECRET });

    expect(await listScheduledTargets()).toContainEqual({
      workspaceId: WS,
      source: "ics",
    });

    expect(await pauseSource(WS, "ics")).toEqual({ found: true, paused: true });
    expect(await loadSourceConfig(WS, "ics")).toEqual({ icsUrl: SECRET });
    expect(await listScheduledTargets()).not.toContainEqual({
      workspaceId: WS,
      source: "ics",
    });

    expect(await resumeSource(WS, "ics")).toEqual({ found: true, paused: false });
    expect(await loadSourceConfig(WS, "ics")).toEqual({ icsUrl: SECRET });
    expect(await listScheduledTargets()).toContainEqual({
      workspaceId: WS,
      source: "ics",
    });
  });
});

describe("clear-error acknowledges after a fix", () => {
  it("clears the stored error and returns the last success stamp", async () => {
    await upsertSyncState({
      source: "ics",
      sourceName: "Calendar",
      lastSync: new Date("2026-08-20T06:00:00.000Z"),
      status: "error",
      error: "401",
      workspaceId: WS,
    });

    expect(await clearSourceError(WS, "ics")).toEqual({
      found: true,
      cleared: true,
    });

    const state = await db
      .select()
      .from(schema.syncState)
      .where(eq(schema.syncState.workspaceId, WS))
      .get();
    expect(state?.status).toBe("success");
    expect(state?.error).toBeNull();
    expect(state?.lastSync?.toISOString()).toBe("2026-08-20T06:00:00.000Z");
  });
});

describe("source lifecycle REST is write-scoped and audited", () => {
  it("DELETE disconnects and PATCH pause / resume / clear-error", async () => {
    const created = await postConnect(
      asAdmin("POST", {
        source: "ics",
        workspaceId: WS,
        credentials: { icsUrl: SECRET },
      })
    );
    expect(created.status).toBe(201);

    const paused = await patchConnect(
      asAdmin("PATCH", {
        source: "ics",
        workspaceId: WS,
        action: "pause",
      })
    );
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({
      source: "ics",
      workspaceId: WS,
      action: "pause",
      paused: true,
    });
    expect(await loadSourceConfig(WS, "ics")).toEqual({ icsUrl: SECRET });
    expect(await listScheduledTargets()).not.toContainEqual({
      workspaceId: WS,
      source: "ics",
    });

    const resumed = await patchConnect(
      asAdmin("PATCH", {
        source: "ics",
        workspaceId: WS,
        action: "resume",
      })
    );
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).paused).toBe(false);

    await upsertSyncState({
      source: "ics",
      sourceName: "Calendar",
      lastSync: new Date("2026-08-20T06:00:00.000Z"),
      status: "error",
      error: "sync failed",
      workspaceId: WS,
    });
    const cleared = await patchConnect(
      asAdmin("PATCH", {
        source: "ics",
        workspaceId: WS,
        action: "clear-error",
      })
    );
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).cleared).toBe(true);

    await db.insert(schema.calEvents).values({
      source: "ics",
      sourceName: "Calendar",
      sourceColor: "#2563eb",
      type: "comms",
      emoji: "📅",
      title: "REST kept",
      badge: "all day",
      eventDate: new Date("2026-08-21T00:00:00.000Z"),
      isFuture: false,
      workspaceId: WS,
    });

    const disconnected = await deleteConnect(
      asAdmin("DELETE", { source: "ics", workspaceId: WS })
    );
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toEqual({
      source: "ics",
      workspaceId: WS,
      disconnected: true,
    });
    expect(await loadSourceCiphertext(WS, "ics")).toBeNull();
    const events = await db
      .select()
      .from(schema.calEvents)
      .where(eq(schema.calEvents.workspaceId, WS))
      .all();
    expect(events[0]?.source).toBe("ics");

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, WS))
      .all();
    expect(audit.map((row) => row.action).sort()).toEqual([
      "connect.clear_error",
      "connect.disconnect",
      "connect.pause",
      "connect.resume",
      "connect.save",
    ]);
  });

  it("refuses unauthenticated lifecycle writes", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");
    const body = { source: "ics", workspaceId: WS, action: "pause" };
    const patch = await patchConnect(
      new NextRequest("http://localhost:3000/api/v1/connect", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
    expect(patch.status).toBe(401);

    const del = await deleteConnect(
      new NextRequest("http://localhost:3000/api/v1/connect", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "ics", workspaceId: WS }),
      })
    );
    expect(del.status).toBe(401);
  });
});

describe("health panel exposes disconnect, pause, and clear-error", () => {
  it("renders lifecycle actions and a paused next-run label", () => {
    const health: SyncHealth[] = [
      {
        source: "mixpanel",
        sourceName: "Mixpanel",
        status: "error",
        lastSynced: "2026-08-20T06:00:00.000Z",
        error: "401",
        paused: false,
      },
      {
        source: "ics",
        sourceName: "Calendar",
        status: "success",
        lastSynced: "2026-08-20T06:00:00.000Z",
        paused: true,
      },
    ];
    const rows = presentConnectorHealth(health, {
      intervalMinutes: 15,
      now: new Date("2026-08-20T06:05:00.000Z"),
    });
    const html = renderToStaticMarkup(
      createElement(ConnectorHealthList, {
        rows,
        syncing: null,
        acting: null,
        onSync: () => undefined,
        onLifecycle: () => undefined,
      })
    );

    expect(html).toContain("Pause");
    expect(html).toContain("Resume");
    expect(html).toContain("Clear error");
    expect(html).toContain("Disconnect");
    expect(html).toContain("Paused");
    expect(html).toContain("Paused. Resume to schedule again.");
    expect(html).not.toContain("401");
  });
});

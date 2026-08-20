import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { upsertConfig, upsertSyncState } from "./upsert";

const WS = "upsert-test";
const OTHER_WS = "upsert-test-other";

afterEach(async () => {
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
  await db
    .delete(schema.syncState)
    .where(eq(schema.syncState.workspaceId, OTHER_WS));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, WS));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, OTHER_WS));
});

describe("upsertSyncState", () => {
  it("does not duplicate two upserts of the same source/workspace", async () => {
    await upsertSyncState({
      source: "posthog",
      sourceName: "PostHog",
      lastSync: new Date("2026-01-01T00:00:00Z"),
      status: "success",
      workspaceId: WS,
    });
    await upsertSyncState({
      source: "posthog",
      sourceName: "PostHog",
      lastSync: new Date("2026-01-02T00:00:00Z"),
      status: "error",
      error: "sync failed",
      workspaceId: WS,
    });

    const rows = await db
      .select()
      .from(schema.syncState)
      .where(
        and(
          eq(schema.syncState.workspaceId, WS),
          eq(schema.syncState.source, "posthog")
        )
      )
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("error");
    expect(rows[0]?.error).toBe("sync failed");
    expect(rows[0]?.lastSync).toEqual(new Date("2026-01-02T00:00:00Z"));
  });

  it("keeps the same source distinct across workspaces", async () => {
    await upsertSyncState({
      source: "posthog",
      sourceName: "PostHog",
      status: "success",
      workspaceId: WS,
    });
    await upsertSyncState({
      source: "posthog",
      sourceName: "PostHog",
      status: "success",
      workspaceId: OTHER_WS,
    });

    const rows = await db
      .select()
      .from(schema.syncState)
      .where(eq(schema.syncState.source, "posthog"))
      .all();

    const workspaces = rows
      .filter((r) => r.workspaceId === WS || r.workspaceId === OTHER_WS)
      .map((r) => r.workspaceId)
      .sort();
    expect(workspaces).toEqual([WS, OTHER_WS].sort());
  });
});

describe("upsertConfig", () => {
  it("does not duplicate two upserts of the same key/workspace", async () => {
    await upsertConfig({
      key: "value_events",
      value: JSON.stringify({ core: "song_played" }),
      workspaceId: WS,
    });
    await upsertConfig({
      key: "value_events",
      value: JSON.stringify({ core: "updated" }),
      workspaceId: WS,
    });

    const rows = await db
      .select()
      .from(schema.config)
      .where(
        and(
          eq(schema.config.workspaceId, WS),
          eq(schema.config.key, "value_events")
        )
      )
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(JSON.stringify({ core: "updated" }));
  });

  it("keeps the same config key distinct across workspaces", async () => {
    await upsertConfig({
      key: "value_events",
      value: JSON.stringify({ core: "left" }),
      workspaceId: WS,
    });
    await upsertConfig({
      key: "value_events",
      value: JSON.stringify({ core: "right" }),
      workspaceId: OTHER_WS,
    });

    const left = await db
      .select()
      .from(schema.config)
      .where(
        and(eq(schema.config.workspaceId, WS), eq(schema.config.key, "value_events"))
      )
      .get();
    const right = await db
      .select()
      .from(schema.config)
      .where(
        and(
          eq(schema.config.workspaceId, OTHER_WS),
          eq(schema.config.key, "value_events")
        )
      )
      .get();

    expect(left?.value).toBe(JSON.stringify({ core: "left" }));
    expect(right?.value).toBe(JSON.stringify({ core: "right" }));
  });
});

import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import {
  fixtureDir,
  installConnectorFetch,
  loadFixtureSuite,
  type InstalledFetch,
} from "./index";

export function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

export async function clearWorkspace(workspaceId: string) {
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, workspaceId));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, workspaceId));
  await db.delete(schema.calEvents).where(eq(schema.calEvents.workspaceId, workspaceId));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, workspaceId));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, workspaceId));
  await db.delete(schema.mrrSnapshots).where(eq(schema.mrrSnapshots.workspaceId, workspaceId));
  await db
    .delete(schema.subscriptionEvents)
    .where(eq(schema.subscriptionEvents.workspaceId, workspaceId));
  await db.delete(schema.personRevenue).where(eq(schema.personRevenue.workspaceId, workspaceId));
  await db
    .delete(schema.balanceSnapshots)
    .where(eq(schema.balanceSnapshots.workspaceId, workspaceId));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, workspaceId));
  await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, workspaceId));
  await db.delete(schema.metricPoints).where(eq(schema.metricPoints.workspaceId, workspaceId));
  await db.delete(schema.tombstones).where(eq(schema.tombstones.workspaceId, workspaceId));
}

export async function withOfflineSuite(
  source: string,
  segments: string[],
  run: (harness: InstalledFetch) => Promise<void>
) {
  const dir = fixtureDir(...segments);
  const suite = loadFixtureSuite(dir);
  const harness = installConnectorFetch({
    fixtures: suite,
    recordDir: dir,
    source,
  });
  try {
    await run(harness);
  } finally {
    harness.restore();
  }
}

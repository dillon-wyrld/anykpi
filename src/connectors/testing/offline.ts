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
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, workspaceId));
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

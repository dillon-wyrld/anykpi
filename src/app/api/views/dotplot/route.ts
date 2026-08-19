import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import { gate } from "@/core/session-auth";
import { ensureWorkspaceClusters } from "@/core/clustering";
import { internalError, logServerError } from "@/core/errors";
import { activityWindow, buildDotPlotUsers } from "@/core/views/dotplot";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requested = searchParams.get("workspace") || "demo";
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;
  const workspace = gated.workspace;

  try {

  await ensureWorkspaceClusters(workspace);

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspace))
    .all();

  const allActivities = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspace))
    .all();

  const { baseDate } = activityWindow([
    ...users.map((u) => u.signupDate),
    ...allActivities.map((a) => a.timestamp),
  ]);

  const result = buildDotPlotUsers(users, allActivities);

  return NextResponse.json({ users: result, days: 28, baseDate: baseDate.toISOString() });
  } catch {
    logServerError("Dotplot view failed");
    return internalError();
  }
}

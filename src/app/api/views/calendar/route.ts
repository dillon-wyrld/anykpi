import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/core/auth";
import { internalError, logServerError } from "@/core/errors";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspace = searchParams.get("workspace") || "demo";
  const denied = await requireAuth(request, { workspace, write: false });
  if (denied) return denied;

  try {

  const events = await db
    .select()
    .from(schema.calEvents)
    .where(eq(schema.calEvents.workspaceId, workspace))
    .orderBy(schema.calEvents.eventDate)
    .all();

  // Get sync states for trust layer
  const syncStates = await db
    .select()
    .from(schema.syncState)
    .where(eq(schema.syncState.workspaceId, workspace))
    .all();

  const syncMap = new Map(syncStates.map(s => [s.source, s]));

  return NextResponse.json({
    events: events.map((e) => {
      const sync = syncMap.get(e.source);
      const ageMs = sync?.lastSync ? Date.now() - sync.lastSync.getTime() : 0;
      const ageStr = ageMs < 60000 ? 'live' : 
                     ageMs < 3600000 ? `${Math.floor(ageMs / 60000)}m ago` :
                     ageMs < 86400000 ? `${Math.floor(ageMs / 3600000)}h ago` :
                     `${Math.floor(ageMs / 86400000)}d ago`;

      return {
        id: e.id,
        source: e.source,
        sourceName: e.sourceName,
        sourceColor: e.sourceColor,
        sourceGlyph: e.emoji,
        type: e.type,
        date: e.eventDate.toISOString(),
        title: e.title,
        badge: e.badge,
        detail: `${e.type} event from ${e.sourceName}`,
        syncAge: ageStr,
      };
    }),
  });
  } catch {
    logServerError("Calendar view failed");
    return internalError();
  }
}

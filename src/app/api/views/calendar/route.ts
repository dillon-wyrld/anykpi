import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspace = searchParams.get("workspace") || "demo";

  const events = await db
    .select()
    .from(schema.calEvents)
    .where(eq(schema.calEvents.workspaceId, workspace))
    .orderBy(schema.calEvents.date)
    .all();

  return NextResponse.json({
    events: events.map((e) => ({
      ...e,
      date: e.date.toISOString(),
    })),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/core/session-auth";
import { internalError, logServerError } from "@/core/errors";
import { loadCalendarView } from "@/core/views/calendar";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requested = searchParams.get("workspace") || "demo";
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;

  try {
    return NextResponse.json(await loadCalendarView(gated.workspace));
  } catch {
    logServerError("Calendar view failed");
    return internalError();
  }
}

import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/core/auth";
import { badRequest, internalError, logServerError } from "@/core/errors";
import { loadPersonPanel } from "@/core/views/person";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requested = searchParams.get("workspace") || "demo";
  const personId = searchParams.get("user");
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;

  if (!personId) {
    return badRequest();
  }

  try {
    const panel = await loadPersonPanel(gated.workspace, personId);
    if (!panel) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }
    return NextResponse.json(panel);
  } catch {
    logServerError("Person view failed");
    return internalError();
  }
}

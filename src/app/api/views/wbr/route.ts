import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/core/session-auth";
import { internalError, logServerError } from "@/core/errors";
import { loadWbrView } from "@/core/views/wbr";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requested = searchParams.get("workspace") || "demo";
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;

  try {
    return NextResponse.json(await loadWbrView(gated.workspace));
  } catch {
    logServerError("WBR view failed");
    return internalError();
  }
}

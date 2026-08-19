import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { authorize, authResponse, LIVE_WORKSPACE } from "@/core/auth";
import { internalError, logServerError } from "@/core/errors";

/**
 * DELETE /api/v1/keys/:id
 *
 * Revoke (permanently delete) an API key. Requires a valid credential (write).
 * A workspace-bound key may only revoke keys in its own workspace; the env
 * admin may revoke any. Unknown or out-of-scope ids return 404 (no existence
 * disclosure).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorize(request, { write: true });
  if (!auth.ok) return authResponse(auth);

  try {
    const { id } = await params;
    const key = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, id))
      .get();

    const inScope =
      !!key &&
      (auth.canChooseWorkspace ||
        (key.workspaceId || LIVE_WORKSPACE) === auth.keyWorkspace);

    if (!inScope) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id));
    return NextResponse.json({ id, revoked: true });
  } catch {
    logServerError("Revoke API key failed");
    return internalError();
  }
}

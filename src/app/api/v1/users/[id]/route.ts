import { NextRequest, NextResponse } from "next/server";
import { DeleteUserResponseSchema } from "@/core/contracts";
import { AUDIT_ACTIONS, recordWriteAudit } from "@/core/audit";
import {
  authorize,
  authResponse,
  extractApiKey,
  resolveWorkspace,
} from "@/core/auth";
import { forbidden, internalError, logServerError } from "@/core/errors";
import { readBrowserSession } from "@/core/session";
import { deletePerson } from "@/core/tombstones";

/**
 * DELETE /api/v1/users/:id
 *
 * Purge a person and their events, cascade through person-level read
 * models, and write a tombstone so the next connector sync, CSV import,
 * or batch ingest cannot resurrect them.
 *
 * Key-only. A browser session is refused with 403 so the audit row
 * always names the deleting actor.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = readBrowserSession(request);
  if (session && !extractApiKey(request)) {
    return forbidden("Person deletion requires an API key");
  }

  const auth = await authorize(request, { write: true });
  if (!auth.ok) return authResponse(auth);

  try {
    const { id } = await params;
    const personId = id?.trim();
    if (!personId) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const requested =
      request.nextUrl.searchParams.get("workspace") ?? undefined;
    const resolved = resolveWorkspace(auth, requested, true);
    if ("ok" in resolved && resolved.ok === false) {
      return authResponse(resolved);
    }
    const workspace = (resolved as { workspace: string }).workspace;

    const result = await deletePerson(workspace, personId);
    if (!result.found) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    await recordWriteAudit(auth, workspace, AUDIT_ACTIONS.usersDelete, personId);

    return NextResponse.json(
      DeleteUserResponseSchema.parse({
        deleted: true,
        personId,
        workspace,
      })
    );
  } catch {
    logServerError("Delete user failed");
    return internalError();
  }
}

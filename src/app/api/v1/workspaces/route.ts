import { NextRequest, NextResponse } from "next/server";
import {
  WorkspaceArchiveRequestSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceListResponseSchema,
} from "@/core/contracts";
import { authorize, authResponse } from "@/core/auth";
import {
  badRequest,
  internalError,
  logServerError,
} from "@/core/errors";
import { AUDIT_ACTIONS, recordWriteAudit } from "@/core/audit";
import {
  archiveWorkspace,
  createWorkspace,
  listWorkspaces,
} from "@/core/workspaces";

function toRecord(row: {
  id: string;
  name: string;
  createdAt: Date;
  archivedAt: Date | null;
}) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

/**
 * GET /api/v1/workspaces
 *
 * Catalog for the dashboard switcher. Names are not secret; live data
 * still requires a key or a session unlock for that workspace.
 */
export async function GET() {
  try {
    const rows = await listWorkspaces();
    return NextResponse.json(
      WorkspaceListResponseSchema.parse({
        workspaces: rows.map(toRecord),
      })
    );
  } catch {
    logServerError("List workspaces failed");
    return internalError();
  }
}

/**
 * POST /api/v1/workspaces
 *
 * Create a live workspace. Admin / env key only.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, { write: true });
  if (!auth.ok) return authResponse(auth);
  if (!auth.canChooseWorkspace) {
    return authResponse({ ok: false, status: 401, error: "Unauthorized" });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = WorkspaceCreateRequestSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);
    const created = await createWorkspace(parsed.data.id, parsed.data.name);
    if (!created.ok) return badRequest(created.error);
    await recordWriteAudit(
      auth,
      created.workspace.id,
      AUDIT_ACTIONS.workspaceCreate,
      created.workspace.id
    );
    return NextResponse.json(
      { workspace: toRecord(created.workspace) },
      { status: 201 }
    );
  } catch {
    logServerError("Create workspace failed");
    return internalError();
  }
}

/**
 * PATCH /api/v1/workspaces
 *
 * Archive a live workspace. Admin / env key only. Demo cannot be archived.
 */
export async function PATCH(request: NextRequest) {
  const auth = await authorize(request, { write: true });
  if (!auth.ok) return authResponse(auth);
  if (!auth.canChooseWorkspace) {
    return authResponse({ ok: false, status: 401, error: "Unauthorized" });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = WorkspaceArchiveRequestSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);
    const archived = await archiveWorkspace(parsed.data.id);
    if (!archived.ok) {
      if (archived.error === "Workspace not found") {
        return NextResponse.json({ error: archived.error }, { status: 404 });
      }
      return badRequest(archived.error);
    }
    await recordWriteAudit(
      auth,
      archived.workspace.id,
      AUDIT_ACTIONS.workspaceArchive,
      archived.workspace.id
    );
    return NextResponse.json({ workspace: toRecord(archived.workspace) });
  } catch {
    logServerError("Archive workspace failed");
    return internalError();
  }
}

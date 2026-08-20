/**
 * Persisted PMF+ outreach drafts. Queue is a write. Approval is
 * session-or-admin only. Delivery lives in `deliver.ts` and refuses
 * anything that is not an approved row.
 */

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { AUDIT_ACTIONS, recordAudit } from "@/core/audit";
import {
  AUDIT_ACTOR_SESSION,
  actorFromAuth,
  DEMO_WORKSPACE,
  LIVE_WORKSPACE,
  authResponse,
  authorize,
  resolveWorkspace,
  type AuthOk,
  type RequestLike,
} from "@/core/auth";
import { db } from "@/core/db";
import { forbidden } from "@/core/errors";
import * as schema from "@/core/schema";
import { authFromSession, readBrowserSession } from "@/core/session";
import {
  OutreachNotFoundError,
  WRITE_CANNOT_APPROVE_OUTREACH,
} from "./errors";

export const OUTREACH_STATES = ["waiting", "approved", "sent"] as const;
export type OutreachState = (typeof OUTREACH_STATES)[number];

export type OutreachRecord = {
  id: string;
  workspaceId: string;
  personId: string;
  body: string;
  state: OutreachState;
  approvedBy: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  sentAt: Date | null;
};

/** A persisted row that has been approved and is legal to pass to deliver. */
export type ApprovedOutreach = OutreachRecord & {
  state: "approved";
  approvedBy: string;
  approvedAt: Date;
};

export function parseOutreachState(value: string): OutreachState {
  if (value === "waiting" || value === "approved" || value === "sent") {
    return value;
  }
  return "waiting";
}

export function toOutreachRecord(row: {
  id: string;
  workspaceId: string;
  personId: string;
  body: string;
  state: string;
  approvedBy: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  sentAt: Date | null;
}): OutreachRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    personId: row.personId,
    body: row.body,
    state: parseOutreachState(row.state),
    approvedBy: row.approvedBy,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    sentAt: row.sentAt,
  };
}

export function asApprovedOutreach(
  record: OutreachRecord
): ApprovedOutreach | null {
  if (record.state !== "approved" || !record.approvedBy || !record.approvedAt) {
    return null;
  }
  return {
    ...record,
    state: "approved",
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
  };
}

export async function loadOutreach(
  workspaceId: string,
  id: string
): Promise<OutreachRecord | null> {
  const [row] = await db
    .select()
    .from(schema.outreach)
    .where(
      and(
        eq(schema.outreach.workspaceId, workspaceId),
        eq(schema.outreach.id, id)
      )
    )
    .all();
  return row ? toOutreachRecord(row) : null;
}

export async function listOutreach(
  workspaceId: string
): Promise<OutreachRecord[]> {
  const rows = await db
    .select()
    .from(schema.outreach)
    .where(eq(schema.outreach.workspaceId, workspaceId))
    .orderBy(desc(schema.outreach.createdAt))
    .all();
  return rows.map(toOutreachRecord);
}

export async function queueOutreach(input: {
  workspaceId: string;
  personId: string;
  body: string;
  actor: string;
}): Promise<OutreachRecord> {
  const now = new Date();
  const id = `ou_${nanoid(16)}`;
  const body = input.body.trim();
  await db.insert(schema.outreach).values({
    id,
    workspaceId: input.workspaceId,
    personId: input.personId,
    body,
    state: "waiting",
    approvedBy: null,
    createdAt: now,
    approvedAt: null,
    sentAt: null,
  });
  await recordAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: AUDIT_ACTIONS.outreachQueue,
    subject: id,
  });
  const saved = await loadOutreach(input.workspaceId, id);
  if (!saved) throw new OutreachNotFoundError();
  return saved;
}

export async function updateOutreachBody(input: {
  workspaceId: string;
  id: string;
  body: string;
}): Promise<OutreachRecord> {
  const existing = await loadOutreach(input.workspaceId, input.id);
  if (!existing) throw new OutreachNotFoundError();
  if (existing.state === "sent") {
    return existing;
  }
  await db
    .update(schema.outreach)
    .set({
      body: input.body.trim(),
      state: "waiting",
      approvedBy: null,
      approvedAt: null,
    })
    .where(
      and(
        eq(schema.outreach.workspaceId, input.workspaceId),
        eq(schema.outreach.id, input.id)
      )
    );
  const saved = await loadOutreach(input.workspaceId, input.id);
  if (!saved) throw new OutreachNotFoundError();
  return saved;
}

export function canApproveOutreach(auth: AuthOk): boolean {
  return auth.actor === "session" || auth.scope === "admin";
}

export function outreachApprover(auth: AuthOk): string {
  if (auth.actor === "session") return AUDIT_ACTOR_SESSION;
  return actorFromAuth(auth);
}

export async function approveOutreach(input: {
  workspaceId: string;
  id: string;
  approvedBy: string;
}): Promise<ApprovedOutreach> {
  const existing = await loadOutreach(input.workspaceId, input.id);
  if (!existing) throw new OutreachNotFoundError();
  if (existing.state === "sent") {
    throw new OutreachNotFoundError("A sent draft cannot be re-approved.");
  }
  const now = new Date();
  await db
    .update(schema.outreach)
    .set({
      state: "approved",
      approvedBy: input.approvedBy,
      approvedAt: now,
    })
    .where(
      and(
        eq(schema.outreach.workspaceId, input.workspaceId),
        eq(schema.outreach.id, input.id)
      )
    );
  await recordAudit({
    workspaceId: input.workspaceId,
    actor: input.approvedBy,
    action: AUDIT_ACTIONS.outreachApprove,
    subject: input.id,
  });
  const saved = await loadOutreach(input.workspaceId, input.id);
  const approved = saved ? asApprovedOutreach(saved) : null;
  if (!approved) throw new OutreachNotFoundError();
  return approved;
}

export type OutreachGateAction = "queue" | "approve" | "send" | "outcome";

export type OutreachGateOk = {
  ok: true;
  auth: AuthOk;
  workspace: string;
};

/**
 * Queue, send, and outcome accept a write (or admin) key, or a browser
 * session. Approve accepts only a browser session or an admin-scoped
 * key — a write key that queued the draft cannot approve it.
 */
export async function gateOutreach(
  request: RequestLike,
  options: { workspace?: string | null; action: OutreachGateAction }
): Promise<OutreachGateOk | { ok: false; response: ReturnType<typeof authResponse> }> {
  const session = readBrowserSession(request);
  if (session) {
    const auth: AuthOk = { ...authFromSession(session), actor: "session" };
    const resolved = resolveWorkspace(auth, options.workspace, false);
    if ("ok" in resolved && resolved.ok === false) {
      return { ok: false, response: authResponse(resolved) };
    }
    return {
      ok: true,
      auth,
      workspace: (resolved as { workspace: string }).workspace,
    };
  }

  const asked = options.workspace ?? undefined;
  const isDemoQueue =
    (options.action === "queue" || options.action === "outcome") &&
    (asked === DEMO_WORKSPACE || !asked);

  if (isDemoQueue) {
    const result = await authorize(request, {
      workspace: asked || DEMO_WORKSPACE,
      write: false,
    });
    if (!result.ok) {
      return { ok: false, response: authResponse(result) };
    }
    if (result.actor !== "anonymous" && result.scope === "read") {
      return {
        ok: false,
        response: authResponse({
          ok: false,
          status: 403,
          error:
            "This API key can only read. Use a write or admin key to queue outreach.",
        }),
      };
    }
    const resolved = resolveWorkspace(result, asked, false);
    if ("ok" in resolved && resolved.ok === false) {
      return { ok: false, response: authResponse(resolved) };
    }
    return {
      ok: true,
      auth: result,
      workspace: (resolved as { workspace: string }).workspace,
    };
  }

  const result = await authorize(request, {
    workspace: asked,
    write: true,
  });
  if (!result.ok) {
    return { ok: false, response: authResponse(result) };
  }

  if (options.action === "approve" && !canApproveOutreach(result)) {
    return {
      ok: false,
      response: forbidden(WRITE_CANNOT_APPROVE_OUTREACH),
    };
  }

  const resolved = resolveWorkspace(result, asked, true);
  if ("ok" in resolved && resolved.ok === false) {
    return { ok: false, response: authResponse(resolved) };
  }

  return {
    ok: true,
    auth: result,
    workspace: (resolved as { workspace: string }).workspace || LIVE_WORKSPACE,
  };
}

import {
  OutreachDraftSchema,
  OutreachDeliverySchema,
  type OutreachDraft,
} from "@/core/contracts";
import { actorFromAuth, type AuthOk } from "@/core/auth";
import { publicBaseUrl } from "@/core/view-state";
import type { NextRequest } from "next/server";
import { outreachApprover, type OutreachRecord } from "./index";
import type { DeliveryLogRow } from "./deliver";

export function serializeDraft(record: OutreachRecord): OutreachDraft {
  return OutreachDraftSchema.parse({
    id: record.id,
    personId: record.personId,
    body: record.body,
    state: record.state,
    approvedBy: record.approvedBy,
    createdAt: record.createdAt.toISOString(),
    approvedAt: record.approvedAt ? record.approvedAt.toISOString() : null,
    sentAt: record.sentAt ? record.sentAt.toISOString() : null,
    workspaceId: record.workspaceId,
  });
}

export function serializeDelivery(row: DeliveryLogRow) {
  return OutreachDeliverySchema.parse({
    id: row.id,
    outreachId: row.outreachId,
    recipient: row.recipient,
    approvedBy: row.approvedBy,
    sentAt: row.sentAt.toISOString(),
    workspaceId: row.workspaceId,
  });
}

export function outreachViewUrl(request: NextRequest | undefined, workspace: string) {
  const base = publicBaseUrl(request);
  return `${base}/dashboard?workspace=${encodeURIComponent(workspace)}&view=pmf`;
}

export function queueActor(auth: AuthOk): string {
  return actorFromAuth(auth);
}

export { outreachApprover };

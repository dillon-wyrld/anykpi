/**
 * The only function that may deliver outreach. It takes a persisted
 * approval record and re-reads the row before sending. Unapproved
 * drafts are refused here — not by convention, by the function.
 */

import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, recordAudit } from "@/core/audit";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import {
  asApprovedOutreach,
  loadOutreach,
  type ApprovedOutreach,
  type OutreachRecord,
} from "./index";
import {
  OutreachAlreadySentError,
  OutreachNoRecipientError,
  OutreachNotApprovedError,
  OutreachNotFoundError,
} from "./errors";
import {
  loadMailCredentials,
  MailNotConfiguredError,
  sendMail,
} from "./transport";

export type DeliveryLogRow = {
  id: number;
  outreachId: string;
  workspaceId: string;
  recipient: string;
  approvedBy: string;
  sentAt: Date;
};

export type DeliverResult = {
  outreach: OutreachRecord;
  delivery: DeliveryLogRow;
};

async function recipientFor(
  workspaceId: string,
  personId: string
): Promise<string | null> {
  const [user] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.workspaceId, workspaceId),
        eq(schema.users.personId, personId)
      )
    )
    .all();
  const email = user?.email?.trim();
  return email && email.length > 0 ? email : null;
}

/**
 * Deliver one approved draft. `approval` must be a persisted approved
 * row (`asApprovedOutreach`). Passing a waiting draft — or an object
 * that merely claims to be approved — refuses.
 */
export async function deliverOutreach(
  approval: ApprovedOutreach | OutreachRecord
): Promise<DeliverResult> {
  const persisted = await loadOutreach(approval.workspaceId, approval.id);
  if (!persisted) {
    throw new OutreachNotFoundError();
  }
  if (persisted.state === "sent") {
    throw new OutreachAlreadySentError();
  }

  const approved = asApprovedOutreach(persisted);
  if (!approved) {
    throw new OutreachNotApprovedError();
  }

  const recipient = await recipientFor(approved.workspaceId, approved.personId);
  if (!recipient) {
    throw new OutreachNoRecipientError();
  }

  const credentials = await loadMailCredentials(approved.workspaceId);
  if (!credentials) {
    throw new MailNotConfiguredError(approved.workspaceId);
  }

  await sendMail(
    {
      to: recipient,
      subject: "a note",
      text: approved.body,
    },
    credentials
  );

  const sentAt = new Date();
  await db
    .update(schema.outreach)
    .set({
      state: "sent",
      sentAt,
    })
    .where(
      and(
        eq(schema.outreach.workspaceId, approved.workspaceId),
        eq(schema.outreach.id, approved.id)
      )
    );

  const inserted = await db
    .insert(schema.outreachDelivery)
    .values({
      outreachId: approved.id,
      workspaceId: approved.workspaceId,
      recipient,
      approvedBy: approved.approvedBy,
      sentAt,
    })
    .returning({ id: schema.outreachDelivery.id });

  const deliveryId = inserted[0]?.id;
  if (deliveryId === undefined) {
    throw new OutreachNotFoundError();
  }

  await recordAudit({
    workspaceId: approved.workspaceId,
    actor: approved.approvedBy,
    action: AUDIT_ACTIONS.outreachSend,
    subject: approved.id,
  });

  const sent = await loadOutreach(approved.workspaceId, approved.id);
  if (!sent) throw new OutreachNotFoundError();

  return {
    outreach: sent,
    delivery: {
      id: deliveryId,
      outreachId: approved.id,
      workspaceId: approved.workspaceId,
      recipient,
      approvedBy: approved.approvedBy,
      sentAt,
    },
  };
}

export async function listDeliveries(
  workspaceId: string
): Promise<DeliveryLogRow[]> {
  const rows = await db
    .select()
    .from(schema.outreachDelivery)
    .where(eq(schema.outreachDelivery.workspaceId, workspaceId))
    .all();
  return rows.map((row) => ({
    id: row.id,
    outreachId: row.outreachId,
    workspaceId: row.workspaceId,
    recipient: row.recipient,
    approvedBy: row.approvedBy,
    sentAt: row.sentAt,
  }));
}

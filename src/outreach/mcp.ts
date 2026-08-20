import type { AuthOk } from "@/core/auth";
import { deliverOutreach } from "./deliver";
import {
  approveOutreach,
  asApprovedOutreach,
  loadOutreach,
  outreachApprover,
  queueOutreach,
} from "./index";
import {
  MailNotConfiguredError,
  OutreachAlreadySentError,
  OutreachNoRecipientError,
  OutreachNotApprovedError,
  OutreachNotFoundError,
  OUTREACH_NOT_APPROVED,
  WRITE_CANNOT_APPROVE_OUTREACH,
} from "./errors";
import { serializeDelivery, serializeDraft } from "./http";
import { queueActor } from "./http";

export const OUTREACH_MCP_TOOLS = [
  {
    name: "queue_outreach",
    description:
      "Queue a persisted outreach draft (waiting). Write scope can queue; it cannot approve.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        personId: { type: "string" },
        body: { type: "string" },
      },
    },
  },
  {
    name: "approve_outreach",
    description:
      "Approve a persisted outreach draft. Browser session or admin key only — a write key cannot approve.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        id: { type: "string" },
      },
    },
  },
  {
    name: "send_outreach",
    description:
      "Deliver an approved outreach draft. Unapproved drafts are refused.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        id: { type: "string" },
      },
    },
  },
] as const;

export type OutreachMcpToolName = (typeof OUTREACH_MCP_TOOLS)[number]["name"];

export function isOutreachMcpTool(
  name: string | undefined
): name is OutreachMcpToolName {
  return (
    name === "queue_outreach" ||
    name === "approve_outreach" ||
    name === "send_outreach"
  );
}

export function outreachMcpAction(
  name: OutreachMcpToolName
): "queue" | "approve" | "send" {
  if (name === "approve_outreach") return "approve";
  if (name === "send_outreach") return "send";
  return "queue";
}

export type OutreachMcpCall =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: 400 | 403 | 404 | 503; error: string };

export async function callOutreachMcpTool(input: {
  name: OutreachMcpToolName;
  auth: AuthOk;
  workspace: string;
  args: {
    personId?: string;
    body?: string;
    id?: string;
  };
}): Promise<OutreachMcpCall> {
  try {
    if (input.name === "queue_outreach") {
      if (!input.args.personId || !input.args.body) {
        return { ok: false, status: 400, error: "personId and body are required" };
      }
      const draft = await queueOutreach({
        workspaceId: input.workspace,
        personId: input.args.personId,
        body: input.args.body,
        actor: queueActor(input.auth),
      });
      return { ok: true, payload: { draft: serializeDraft(draft) } };
    }

    if (input.name === "approve_outreach") {
      if (!input.args.id) {
        return { ok: false, status: 400, error: "id is required" };
      }
      const draft = await approveOutreach({
        workspaceId: input.workspace,
        id: input.args.id,
        approvedBy: outreachApprover(input.auth),
      });
      return { ok: true, payload: { draft: serializeDraft(draft) } };
    }

    if (!input.args.id) {
      return { ok: false, status: 400, error: "id is required" };
    }
    const record = await loadOutreach(input.workspace, input.args.id);
    if (!record) {
      return { ok: false, status: 404, error: "Outreach draft not found." };
    }
    if (!asApprovedOutreach(record)) {
      return { ok: false, status: 403, error: OUTREACH_NOT_APPROVED };
    }
    const result = await deliverOutreach(record);
    return {
      ok: true,
      payload: {
        draft: serializeDraft(result.outreach),
        delivery: serializeDelivery(result.delivery),
      },
    };
  } catch (error) {
    if (error instanceof OutreachNotApprovedError) {
      return { ok: false, status: 403, error: OUTREACH_NOT_APPROVED };
    }
    if (error instanceof OutreachNotFoundError) {
      return { ok: false, status: 404, error: error.message };
    }
    if (
      error instanceof OutreachAlreadySentError ||
      error instanceof OutreachNoRecipientError
    ) {
      return { ok: false, status: 400, error: error.message };
    }
    if (error instanceof MailNotConfiguredError) {
      return { ok: false, status: 503, error: error.message };
    }
    throw error;
  }
}

export { WRITE_CANNOT_APPROVE_OUTREACH, OUTREACH_NOT_APPROVED };

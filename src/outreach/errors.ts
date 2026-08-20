export const OUTREACH_NOT_APPROVED =
  "Outreach is not approved. Nothing sends until a founder or admin approves the persisted draft.";

export const WRITE_CANNOT_APPROVE_OUTREACH =
  "A write-scoped key can queue outreach but cannot approve it. Approve from the browser session or an admin key.";

export const OUTREACH_ALREADY_SENT = "This outreach has already been sent.";

export const OUTREACH_NOT_FOUND = "Outreach draft not found.";

export const OUTREACH_NO_RECIPIENT =
  "This person has no email address, so the message cannot be delivered.";

export class OutreachNotApprovedError extends Error {
  constructor(message = OUTREACH_NOT_APPROVED) {
    super(message);
    this.name = "OutreachNotApprovedError";
  }
}

export class OutreachAlreadySentError extends Error {
  constructor(message = OUTREACH_ALREADY_SENT) {
    super(message);
    this.name = "OutreachAlreadySentError";
  }
}

export class OutreachNotFoundError extends Error {
  constructor(message = OUTREACH_NOT_FOUND) {
    super(message);
    this.name = "OutreachNotFoundError";
  }
}

export class OutreachNoRecipientError extends Error {
  constructor(message = OUTREACH_NO_RECIPIENT) {
    super(message);
    this.name = "OutreachNoRecipientError";
  }
}

export class MailNotConfiguredError extends Error {
  constructor(workspaceId: string) {
    super(
      `No mail credentials for workspace ${workspaceId}. Store a Resend key or SMTP config via /connect (source resend or smtp).`
    );
    this.name = "MailNotConfiguredError";
  }
}

export class MailSendError extends Error {
  constructor(message = "Mail send failed") {
    super(message);
    this.name = "MailSendError";
  }
}

/**
 * Mail transport for approved outreach. The only importer of this
 * module is `deliver.ts` — nothing else may send.
 *
 * Credentials come from the ANY-46 sources store (`resend` or `smtp`).
 * Never log credentials.
 */

import { loadSourceConfig } from "@/core/sources";
import { MailNotConfiguredError, MailSendError } from "./errors";

export { MailNotConfiguredError, MailSendError };

export const MAIL_SOURCE_RESEND = "resend";
export const MAIL_SOURCE_SMTP = "smtp";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type ResendCredentials = {
  kind: "resend";
  apiKey: string;
  from: string;
};

export type SmtpCredentials = {
  kind: "smtp";
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
};

export type MailCredentials = ResendCredentials | SmtpCredentials;

function firstString(
  config: Record<string, string>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function credentialsFromConfig(
  source: string,
  config: Record<string, string> | null
): MailCredentials | null {
  if (!config) return null;
  if (source === MAIL_SOURCE_RESEND) {
    const apiKey = firstString(config, ["apiKey", "resendApiKey", "key"]);
    const from = firstString(config, ["from", "fromAddress", "fromEmail"]);
    if (!apiKey || !from) return null;
    return { kind: "resend", apiKey, from };
  }
  if (source === MAIL_SOURCE_SMTP) {
    const host = firstString(config, ["host", "smtpHost"]);
    const from = firstString(config, ["from", "fromAddress", "fromEmail"]);
    const user = firstString(config, ["user", "username", "smtpUser"]) ?? "";
    const pass = firstString(config, ["pass", "password", "smtpPass"]) ?? "";
    const portRaw = firstString(config, ["port", "smtpPort"]);
    const port = portRaw ? Number(portRaw) : 587;
    if (!host || !from || !Number.isFinite(port)) return null;
    const secure =
      firstString(config, ["secure"]) === "true" || port === 465;
    return { kind: "smtp", host, port, user, pass, from, secure };
  }
  return null;
}

export async function loadMailCredentials(
  workspaceId: string
): Promise<MailCredentials | null> {
  const resend = credentialsFromConfig(
    MAIL_SOURCE_RESEND,
    await loadSourceConfig(workspaceId, MAIL_SOURCE_RESEND)
  );
  if (resend) return resend;
  return credentialsFromConfig(
    MAIL_SOURCE_SMTP,
    await loadSourceConfig(workspaceId, MAIL_SOURCE_SMTP)
  );
}

async function sendResend(
  message: MailMessage,
  creds: ResendCredentials
): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${creds.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: creds.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  });
  if (!response.ok) {
    throw new MailSendError();
  }
}

function smtpEscape(line: string): string {
  return line.startsWith(".") ? `.${line}` : line;
}

async function sendSmtp(
  message: MailMessage,
  creds: SmtpCredentials
): Promise<void> {
  const net = await import("node:net");
  const tls = await import("node:tls");

  await new Promise<void>((resolve, reject) => {
    const socket = creds.secure
      ? tls.connect({ host: creds.host, port: creds.port })
      : net.connect({ host: creds.host, port: creds.port });

    let buffer = "";
    let step = 0;
    const lines = message.text.split(/\r?\n/).map(smtpEscape);

    const write = (command: string) => {
      socket.write(`${command}\r\n`);
    };

    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(15_000, () => fail(new MailSendError()));
    socket.on("error", () => fail(new MailSendError()));
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const parts = buffer.split("\r\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const code = Number(line.slice(0, 3));
        if (!Number.isFinite(code) || line[3] === "-") continue;
        try {
          if (step === 0 && code === 220) {
            write(`EHLO anykpi`);
            step = 1;
          } else if (step === 1 && code === 250) {
            if (creds.user) {
              write("AUTH LOGIN");
              step = 2;
            } else {
              write(`MAIL FROM:<${creds.from}>`);
              step = 5;
            }
          } else if (step === 2 && code === 334) {
            write(Buffer.from(creds.user).toString("base64"));
            step = 3;
          } else if (step === 3 && code === 334) {
            write(Buffer.from(creds.pass).toString("base64"));
            step = 4;
          } else if (step === 4 && code === 235) {
            write(`MAIL FROM:<${creds.from}>`);
            step = 5;
          } else if (step === 5 && code === 250) {
            write(`RCPT TO:<${message.to}>`);
            step = 6;
          } else if (step === 6 && (code === 250 || code === 251)) {
            write("DATA");
            step = 7;
          } else if (step === 7 && code === 354) {
            write(`From: ${creds.from}`);
            write(`To: ${message.to}`);
            write(`Subject: ${message.subject}`);
            write("");
            for (const bodyLine of lines) write(bodyLine);
            write(".");
            step = 8;
          } else if (step === 8 && code === 250) {
            write("QUIT");
            step = 9;
          } else if (step === 9 && (code === 221 || code === 250)) {
            socket.end();
            resolve();
          } else if (code >= 400) {
            fail(new MailSendError());
          }
        } catch {
          fail(new MailSendError());
        }
      }
    });
  });
}

/** The only function that talks to a mail provider. */
export async function sendMail(
  message: MailMessage,
  credentials: MailCredentials
): Promise<void> {
  if (credentials.kind === "resend") {
    await sendResend(message, credentials);
    return;
  }
  await sendSmtp(message, credentials);
}

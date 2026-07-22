import nodemailer from "nodemailer";
import { MailAccount, accountPassword } from "./mailAccounts";

export interface SendParams {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  // Threading: bei Antworten den Bezug setzen, damit die Mail im Thread landet.
  inReplyTo?: string | null;
  references?: string | null;
  fromName?: string | null;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

function transport(acc: MailAccount) {
  return nodemailer.createTransport({
    host: acc.smtp_host,
    port: acc.smtp_port,
    // secure=true → 465 (SSL); false → 587 (STARTTLS).
    secure: (acc as any).smtp_secure === true,
    auth: { user: acc.username, pass: accountPassword(acc) },
    requireTLS: (acc as any).smtp_secure !== true, // STARTTLS erzwingen bei 587
    connectionTimeout: 20_000
  });
}

// Prüft NUR die SMTP-Anmeldung (für „Verbindung testen").
export async function verifySmtp(acc: MailAccount): Promise<void> {
  const t = transport(acc);
  await t.verify();
  t.close();
}

// Versendet eine Nachricht über das SMTP des eigenen Kontos.
// Absender = das verbundene Konto (acc.email). Sendet erst nach Bestätigung.
export async function sendMail(acc: MailAccount, p: SendParams): Promise<string> {
  const t = transport(acc);
  const info = await t.sendMail({
    from: p.fromName ? { name: p.fromName, address: acc.email } : acc.email,
    to: p.to,
    cc: p.cc || undefined,
    bcc: p.bcc || undefined,
    subject: p.subject,
    text: p.text,
    inReplyTo: p.inReplyTo || undefined,
    references: p.references || undefined,
    attachments: p.attachments && p.attachments.length ? p.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) : undefined
  });
  t.close();
  return info.messageId || "";
}

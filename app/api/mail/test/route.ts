import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { encrypt } from "@/lib/crypto";
import { providerPreset } from "@/lib/mailProviders";
import { verifyLogin } from "@/lib/imapSync";
import { verifySmtp } from "@/lib/mailSend";
import { MailAccount } from "@/lib/mailAccounts";
import { friendlyMailError } from "@/lib/mailErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// „Verbindung testen": prüft IMAP-Empfang und SMTP-Versand getrennt.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const preset = providerPreset(String(body.provider || ""));
  if (!preset) return NextResponse.json({ error: "Unbekannter Anbieter." }, { status: 400 });

  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) return NextResponse.json({ error: "E-Mail und Passwort erforderlich." }, { status: 400 });

  const temp = {
    id: "temp", user_id: user.id, provider: preset.id, email,
    imap_host: String(body.imapHost || preset.imapHost).trim(),
    imap_port: Number(body.imapPort || preset.imapPort),
    imap_secure: body.imapSecure != null ? !!body.imapSecure : preset.imapSecure,
    smtp_host: String(body.smtpHost || preset.smtpHost).trim(),
    smtp_port: Number(body.smtpPort || preset.smtpPort),
    smtp_secure: body.smtpSecure != null ? !!body.smtpSecure : preset.smtpSecure,
    display_name: email, username: String(body.username || email).trim(),
    password_enc: encrypt(password), status: "connected",
    inbox_uidvalidity: null, inbox_last_uid: 0
  } as unknown as MailAccount;

  const result = { imap: { ok: false, msg: "" }, smtp: { ok: false, msg: "" } };
  try {
    await verifyLogin(temp);
    result.imap = { ok: true, msg: "IMAP-Empfang & Anmeldung OK" };
  } catch (e) {
    result.imap = { ok: false, msg: friendlyMailError(e as Error) };
  }
  try {
    await verifySmtp(temp);
    result.smtp = { ok: true, msg: "SMTP-Versand & Anmeldung OK" };
  } catch (e) {
    result.smtp = { ok: false, msg: friendlyMailError(e as Error) };
  }

  return NextResponse.json(result);
}

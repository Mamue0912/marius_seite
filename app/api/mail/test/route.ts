import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { encrypt } from "@/lib/crypto";
import { providerPreset } from "@/lib/mailProviders";
import { verifyLogin } from "@/lib/imapSync";
import { verifySmtp } from "@/lib/mailSend";
import { MailAccount } from "@/lib/mailAccounts";
import { friendlyMailError } from "@/lib/mailErrors";
import { assertPublicNetworkHost } from "@/lib/safeRemote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

function validPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  const preset = providerPreset(String(body.provider || ""));
  if (!preset) return NextResponse.json({ error: "Unbekannter Anbieter." }, { status: 400 });

  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) return NextResponse.json({ error: "E-Mail und Passwort erforderlich." }, { status: 400 });

  const imapHost = String(body.imapHost || preset.imapHost).trim();
  const smtpHost = String(body.smtpHost || preset.smtpHost).trim();
  const imapPort = Number(body.imapPort || preset.imapPort);
  const smtpPort = Number(body.smtpPort || preset.smtpPort);
  if (!validPort(imapPort) || !validPort(smtpPort)) {
    return NextResponse.json({ error: "Ungültiger IMAP- oder SMTP-Port." }, { status: 400 });
  }
  try {
    await Promise.all([assertPublicNetworkHost(imapHost), assertPublicNetworkHost(smtpHost)]);
  } catch {
    return NextResponse.json({ error: "Die Serveradresse ist nicht zulässig oder nicht erreichbar." }, { status: 400 });
  }

  const temp = {
    id: "temp", user_id: user.id, provider: preset.id, email,
    imap_host: imapHost,
    imap_port: imapPort,
    imap_secure: body.imapSecure != null ? !!body.imapSecure : preset.imapSecure,
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    smtp_secure: body.smtpSecure != null ? !!body.smtpSecure : preset.smtpSecure,
    display_name: email, username: String(body.username || email).trim(),
    password_enc: encrypt(password), status: "connected",
    inbox_uidvalidity: null, inbox_last_uid: 0
  } as unknown as MailAccount;

  const result = { imap: { ok: false, msg: "" }, smtp: { ok: false, msg: "" } };
  try {
    await verifyLogin(temp);
    result.imap = { ok: true, msg: "IMAP-Empfang & Anmeldung OK" };
  } catch (error) {
    result.imap = { ok: false, msg: friendlyMailError(error as Error) };
  }
  try {
    await verifySmtp(temp);
    result.smtp = { ok: true, msg: "SMTP-Versand & Anmeldung OK" };
  } catch (error) {
    result.smtp = { ok: false, msg: friendlyMailError(error as Error) };
  }

  return NextResponse.json(result);
}
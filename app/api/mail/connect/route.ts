import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encrypt } from "@/lib/crypto";
import { providerPreset } from "@/lib/mailProviders";
import { verifyLogin, syncInbox } from "@/lib/imapSync";
import { verifySmtp } from "@/lib/mailSend";
import { MailAccount } from "@/lib/mailAccounts";
import { friendlyMailError } from "@/lib/mailErrors";
import { assertPublicNetworkHost } from "@/lib/safeRemote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function validPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });

  const provider = String(body.provider || "");
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim() || email;
  const preset = providerPreset(provider);

  if (!preset) return NextResponse.json({ error: "Unbekannter Anbieter." }, { status: 400 });
  if (!email || !password) return NextResponse.json({ error: "E-Mail und Passwort sind erforderlich." }, { status: 400 });

  const imap_host = String(body.imapHost || preset.imapHost || "").trim();
  const imap_port = Number(body.imapPort || preset.imapPort);
  const imap_secure = body.imapSecure != null ? !!body.imapSecure : preset.imapSecure;
  const smtp_host = String(body.smtpHost || preset.smtpHost || "").trim();
  const smtp_port = Number(body.smtpPort || preset.smtpPort);
  const smtp_secure = body.smtpSecure != null ? !!body.smtpSecure : preset.smtpSecure;
  const username = String(body.username || email).trim();

  if (!imap_host || !smtp_host) {
    return NextResponse.json({ error: "IMAP- und SMTP-Server sind erforderlich." }, { status: 400 });
  }
  if (!validPort(imap_port) || !validPort(smtp_port)) {
    return NextResponse.json({ error: "Ungültiger IMAP- oder SMTP-Port." }, { status: 400 });
  }
  try {
    await Promise.all([assertPublicNetworkHost(imap_host), assertPublicNetworkHost(smtp_host)]);
  } catch {
    return NextResponse.json({ error: "Die Serveradresse ist nicht zulässig oder nicht erreichbar." }, { status: 400 });
  }

  const password_enc = encrypt(password);
  const temp = {
    id: "temp", user_id: user.id, provider: preset.id, email,
    imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
    display_name: displayName, username, password_enc, status: "connected",
    inbox_uidvalidity: null, inbox_last_uid: 0
  } as unknown as MailAccount;

  try {
    await verifyLogin(temp);
  } catch (error) {
    return NextResponse.json({ error: "IMAP: " + friendlyMailError(error as Error) }, { status: 400 });
  }

  let smtpOk = true;
  let smtpMsg = "";
  try {
    await verifySmtp(temp);
  } catch (error) {
    smtpOk = false;
    smtpMsg = friendlyMailError(error as Error);
  }

  const admin = supabaseAdmin();
  const { data: account, error } = await admin
    .from("mail_accounts")
    .upsert(
      {
        user_id: user.id, provider: preset.id, email, display_name: displayName,
        imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
        username, password_enc,
        status: "connected", last_error: null, updated_at: new Date().toISOString()
      },
      { onConflict: "user_id,email" }
    )
    .select()
    .single();

  if (error || !account) {
    return NextResponse.json({ error: "Speichern fehlgeschlagen: " + (error?.message || "unbekannt") }, { status: 500 });
  }

  let synced = 0;
  try {
    const result = await Promise.race([
      syncInbox(account as MailAccount),
      new Promise<{ processed: number }>((_, reject) => setTimeout(() => reject(new Error("sync_timeout")), 18000))
    ]);
    synced = result.processed;
  } catch (error) {
    await admin.from("mail_accounts").update({ last_error: (error as Error).message }).eq("id", (account as MailAccount).id);
  }

  return NextResponse.json({ ok: true, email, synced, smtpOk, smtpMsg });
}
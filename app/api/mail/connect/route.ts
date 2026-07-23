import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encrypt } from "@/lib/crypto";
import { providerPreset } from "@/lib/mailProviders";
import { verifyLogin, syncInbox } from "@/lib/imapSync";
import { verifySmtp } from "@/lib/mailSend";
import { MailAccount } from "@/lib/mailAccounts";
import { friendlyMailError } from "@/lib/mailErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Verbindet ein IMAP/SMTP-Postfach. Prüft IMAP + SMTP getrennt, speichert die
// Zugangsdaten verschlüsselt und lädt die ersten Mails.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const provider = String(body.provider || "");
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim() || email;
  const preset = providerPreset(provider);

  if (!preset) return NextResponse.json({ error: "Unbekannter Anbieter." }, { status: 400 });
  if (!email || !password) return NextResponse.json({ error: "E-Mail und Passwort sind erforderlich." }, { status: 400 });

  // Manuelle Serverdaten (bei „custom" bzw. wenn angegeben) überschreiben Presets.
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

  const password_enc = encrypt(password);
  const temp = {
    id: "temp", user_id: user.id, provider: preset.id, email,
    imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
    display_name: displayName, username, password_enc, status: "connected",
    inbox_uidvalidity: null, inbox_last_uid: 0
  } as unknown as MailAccount;

  // IMAP prüfen.
  try {
    await verifyLogin(temp);
  } catch (e) {
    return NextResponse.json({ error: `IMAP: ${friendlyMailError(e as Error)}` }, { status: 400 });
  }
  // SMTP prüfen (nicht fatal für das Lesen, aber wichtig fürs Antworten).
  let smtpOk = true;
  let smtpMsg = "";
  try {
    await verifySmtp(temp);
  } catch (e) {
    smtpOk = false;
    smtpMsg = friendlyMailError(e as Error);
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
    return NextResponse.json({ error: `Speichern fehlgeschlagen: ${error?.message || "unbekannt"}` }, { status: 500 });
  }

  let synced = 0;
  try {
    synced = (await syncInbox(account as MailAccount)).processed;
  } catch (e) {
    await admin.from("mail_accounts").update({ last_error: (e as Error).message }).eq("id", (account as any).id);
  }

  return NextResponse.json({ ok: true, email, synced, smtpOk, smtpMsg });
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encrypt } from "@/lib/crypto";
import { providerPreset } from "@/lib/mailProviders";
import { verifyLogin, syncInbox } from "@/lib/imapSync";
import { MailAccount } from "@/lib/mailAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Verbindet ein IMAP-Postfach (iCloud, web.de, …). Prüft die Zugangsdaten,
// speichert das Passwort verschlüsselt und lädt die ersten Mails.
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
  const preset = providerPreset(provider);

  if (!preset) return NextResponse.json({ error: "Unbekannter Anbieter." }, { status: 400 });
  if (!email || !password) return NextResponse.json({ error: "E-Mail und Passwort sind erforderlich." }, { status: 400 });

  const password_enc = encrypt(password);

  // Temporäres Konto-Objekt zur Login-Prüfung (noch nicht gespeichert).
  const temp: MailAccount = {
    id: "temp",
    user_id: user.id,
    provider: preset.id,
    email,
    imap_host: preset.imapHost,
    imap_port: preset.imapPort,
    smtp_host: preset.smtpHost,
    smtp_port: preset.smtpPort,
    username: email,
    password_enc,
    status: "connected",
    inbox_uidvalidity: null,
    inbox_last_uid: 0
  };

  try {
    await verifyLogin(temp);
  } catch (e) {
    // Klartext-Fehler an die UI (z. B. „Authentication failed").
    return NextResponse.json({ error: `Anmeldung fehlgeschlagen: ${(e as Error).message}` }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: account, error } = await admin
    .from("mail_accounts")
    .upsert(
      {
        user_id: user.id,
        provider: preset.id,
        email,
        imap_host: preset.imapHost,
        imap_port: preset.imapPort,
        smtp_host: preset.smtpHost,
        smtp_port: preset.smtpPort,
        username: email,
        password_enc,
        status: "connected",
        last_error: null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id,email" }
    )
    .select()
    .single();

  if (error || !account) {
    return NextResponse.json({ error: `Speichern fehlgeschlagen: ${error?.message || "unbekannt"}` }, { status: 500 });
  }

  // Erst-Synchronisierung (Fehler hier nicht fatal – Sync-Knopf holt nach).
  let synced = 0;
  try {
    synced = await syncInbox(account as MailAccount);
  } catch (e) {
    await admin.from("mail_accounts").update({ last_error: (e as Error).message }).eq("id", (account as any).id);
  }

  return NextResponse.json({ ok: true, email, synced });
}

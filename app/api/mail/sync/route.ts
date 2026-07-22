import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccounts } from "@/lib/mailAccounts";
import { syncInbox } from "@/lib/imapSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manuelle Aktualisierung: holt neue Mails aller IMAP-Konten des Nutzers.
// ?reseed=1 setzt den UID-Zeiger zurück → die letzten ~40 Mails werden neu
// abgeholt (Rettung, falls der Zeiger fälschlich vorgerückt war).
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const accounts = await loadMailAccounts(user.id);
  if (!accounts.length) return NextResponse.json({ connected: false });

  const admin = supabaseAdmin();
  const params = new URL(req.url).searchParams;
  const reseed = params.get("reseed") === "1";
  const clean = params.get("clean") === "1";
  if (clean) {
    // Bereinigt: alle gespeicherten Mails löschen und komplett neu einlesen –
    // korrigiert falsch zugeordnete Altdatensätze (Konto-Verwechslung).
    await admin.from("messages").delete().eq("user_id", user.id);
    await admin.from("mail_accounts").update({ inbox_last_uid: 0, inbox_uidvalidity: null }).eq("user_id", user.id);
    for (const a of accounts as any[]) { a.inbox_last_uid = 0; a.inbox_uidvalidity = null; }
  } else if (reseed) {
    await admin.from("mail_accounts").update({ inbox_last_uid: 0, inbox_uidvalidity: null }).eq("user_id", user.id);
    for (const a of accounts as any[]) { a.inbox_last_uid = 0; a.inbox_uidvalidity = null; }
  }
  let processed = 0;
  const errors: string[] = [];
  const report: any[] = [];
  for (const acc of accounts) {
    try {
      const r = await syncInbox(acc);
      processed += r.processed;
      report.push({ email: acc.email, newUids: r.newUids.length, saved: r.saved, skipped: r.skipped, skippedUids: r.skippedUids.slice(0, 10) });
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`${acc.email}: ${msg}`);
      report.push({ email: acc.email, error: msg });
      await admin.from("mail_accounts").update({ status: "error", last_error: msg }).eq("id", acc.id);
    }
  }

  return NextResponse.json({ connected: true, processed, errors, report, at: new Date().toISOString() });
}

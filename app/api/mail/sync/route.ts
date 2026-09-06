import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccounts } from "@/lib/mailAccounts";
import { mapLimit } from "@/lib/concurrency";
import { syncInbox } from "@/lib/imapSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manuelle Aktualisierung: holt neue Mails aller IMAP-Konten des Nutzers.
// ?reseed=1 setzt den UID-Zeiger zurück → die letzten ~150 Mails werden neu
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
  if (clean || reseed) {
    // Erst den Cursor sicher zurücksetzen. So kann ein nachfolgender Fehler beim
    // Bereinigen keine Nachrichten dauerhaft aus dem nächsten Abruf ausschließen.
    const { error: resetError } = await admin.from("mail_accounts").update({ inbox_last_uid: 0, inbox_uidvalidity: null }).eq("user_id", user.id);
    if (resetError) return NextResponse.json({ error: "db_error", message: "Der Synchronisierungsstand konnte nicht zurückgesetzt werden." }, { status: 500 });
    for (const account of accounts as any[]) { account.inbox_last_uid = 0; account.inbox_uidvalidity = null; }
  }
  if (clean) {
    // Bereinigt: alle gespeicherten Mails löschen und komplett neu einlesen –
    // korrigiert falsch zugeordnete Altdatensätze (Konto-Verwechslung).
    const { error: deleteError } = await admin.from("messages").delete().eq("user_id", user.id);
    if (deleteError) return NextResponse.json({ error: "db_error", message: "Gespeicherte Nachrichten konnten nicht bereinigt werden." }, { status: 500 });
  }
  let processed = 0;
  const errors: string[] = [];
  const report: any[] = [];
  await mapLimit(accounts, 2, async (acc) => {
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
  });

  return NextResponse.json({ connected: true, processed, errors, report, at: new Date().toISOString() });
}

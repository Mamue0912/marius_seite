import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccounts } from "@/lib/mailAccounts";
import { syncInbox } from "@/lib/imapSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manuelle Aktualisierung: holt neue Mails aller IMAP-Konten des Nutzers.
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const accounts = await loadMailAccounts(user.id);
  if (!accounts.length) return NextResponse.json({ connected: false });

  const admin = supabaseAdmin();
  let processed = 0;
  const errors: string[] = [];
  for (const acc of accounts) {
    try {
      processed += await syncInbox(acc);
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`${acc.email}: ${msg}`);
      await admin.from("mail_accounts").update({ status: "error", last_error: msg }).eq("id", acc.id);
    }
  }

  return NextResponse.json({ connected: true, processed, errors });
}

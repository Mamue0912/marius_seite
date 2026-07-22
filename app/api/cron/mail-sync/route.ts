import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "../_auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllMailAccounts } from "@/lib/mailAccounts";
import { syncInbox } from "@/lib/imapSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Täglicher Cron (Hobby-Plan): holt neue Mails aller verbundenen IMAP-Konten,
// damit auch ohne geöffnetes Cockpit synchronisiert wird.
export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req);
  if (denied) return denied;

  const admin = supabaseAdmin();
  const accounts = await loadAllMailAccounts();
  let processed = 0;
  for (const acc of accounts) {
    try {
      processed += (await syncInbox(acc)).processed;
    } catch (e) {
      await admin
        .from("mail_accounts")
        .update({ status: "error", last_error: (e as Error).message })
        .eq("id", acc.id);
    }
  }
  return NextResponse.json({ ok: true, accounts: accounts.length, processed });
}

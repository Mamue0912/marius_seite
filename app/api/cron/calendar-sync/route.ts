import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "../_auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchIcloudSnapshot, IcloudAccount, IcloudAuthError } from "@/lib/icloudCalendar";
import { syncIcloudTasks } from "@/lib/calendarTaskSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req);
  if (denied) return denied;
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("icloud_accounts").select("*");
  if (error) return NextResponse.json({ ok: false, error: "accounts_failed" }, { status: 500 });

  const now = new Date();
  const min = new Date(now); min.setDate(min.getDate() - 30);
  const max = new Date(now); max.setDate(max.getDate() + 400);
  let synced = 0;
  let failed = 0;
  for (const account of (data || []) as IcloudAccount[]) {
    try {
      const snapshot = await fetchIcloudSnapshot(account, min.toISOString(), max.toISOString());
      if (snapshot.selectedCalendarCount > 0) {
        const result = await syncIcloudTasks(account.user_id, snapshot.events, min.toISOString(), max.toISOString());
        synced += result.synced;
      }
      await admin.from("icloud_accounts").update({ status: "connected", last_error: null, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", account.id);
    } catch (caught) {
      failed++;
      const authFailed = caught instanceof IcloudAuthError;
      await admin.from("icloud_accounts").update({ status: authFailed ? "needs_reauth" : "error", last_error: authFailed ? "Erneute Verbindung erforderlich." : "Kalendersynchronisierung fehlgeschlagen.", updated_at: new Date().toISOString() }).eq("id", account.id);
    }
  }
  return NextResponse.json({ ok: failed === 0, accounts: (data || []).length, synced, failed });
}
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccounts } from "@/lib/mailAccounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner-Diagnose der Mail-Synchronisierung. Keine Passwörter/Tokens/Inhalte.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const accounts = await loadMailAccounts(user.id);

  const dbInboxTotal = (await admin.from("messages").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_deleted", false).eq("folder_type", "inbox")).count || 0;
  const dbInboxUnread = (await admin.from("messages").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_deleted", false).eq("folder_type", "inbox").eq("is_read", false)).count || 0;
  const dbUnclassified = (await admin.from("messages").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_deleted", false).is("classified_at", null)).count || 0;

  const { data: folders } = await admin.from("mail_folders").select("account_id,folder_type,unread").eq("user_id", user.id).eq("folder_type", "inbox");

  const perAccount = accounts.map((a: any) => {
    const imapUnread = (folders || []).filter((f) => f.account_id === a.id).reduce((s, f) => s + (f.unread || 0), 0);
    return {
      email: a.email, provider: a.provider,
      last_synced_at: a.last_synced_at || null,
      inbox_last_uid: a.inbox_last_uid || 0,
      status: a.status || null,
      last_error: a.last_error || null,
      imapInboxUnread: imapUnread
    };
  });

  return NextResponse.json({
    accounts: perAccount,
    db: { inboxTotal: dbInboxTotal, inboxUnread: dbInboxUnread, unclassified: dbUnclassified },
    at: new Date().toISOString()
  });
}

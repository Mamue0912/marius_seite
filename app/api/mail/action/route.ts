import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { imapAction } from "@/lib/imapActions";
import { extractUid } from "@/lib/imapFetch";
import { friendlyMailError } from "@/lib/mailErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Führt Mailaktionen ECHT über IMAP aus (Papierkorb/Archiv/Junk, gelesen/ungelesen).
// Erst nach Serverbestätigung wird der lokale Status angepasst.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { messageId, action } = await req.json();
  if (!["delete", "archive", "spam", "read", "unread"].includes(action)) return NextResponse.json({ error: "bad_action" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const account = msg.mail_account_id ? await loadMailAccount(msg.mail_account_id) : null;
  const uid = extractUid(msg.web_link);
  if (!account || account.user_id !== user.id || !uid) return NextResponse.json({ error: "no_source" }, { status: 400 });

  try {
    const res = await imapAction(account as MailAccount, msg.original_folder_name || "INBOX", uid, action);
    const patch: any = action === "read" ? {is_read:true} : action === "unread" ? {is_read:false}
      : res.movedTo === "trash" ? {is_deleted:true}
      : {folder_type:res.movedTo,original_folder_name:res.path,web_link:res.uid ? "imap-uid:"+res.uid : null};
    const {error} = await admin.from("messages").update(patch).eq("id",msg.id).eq("user_id",user.id);
    return NextResponse.json({ok:true,movedTo:res.movedTo,warning:error?"Serveraktion ausgeführt. Der lokale Status muss erneut synchronisiert werden.":null});
  } catch (e) {
    return NextResponse.json({ error: "action_failed", message: friendlyMailError(e as Error) }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidAccessToken } from "@/lib/tokens";
import { createOrUpdateReplyDraft, sendDraft } from "@/lib/graphMail";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Versendet den Entwurf – NUR nach ausdrücklicher Bestätigung (confirm=true)
// und nur, wenn der Versand aktiviert ist (ENABLE_SEND / Mail.Send).
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!env.enableSend()) {
    return NextResponse.json({ error: "send_disabled", message: "Versand ist nicht aktiviert (ENABLE_SEND=false)." }, { status: 403 });
  }

  const { messageId, confirm } = await req.json();
  if (confirm !== true) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg || !msg.draft_body) return NextResponse.json({ error: "no_draft" }, { status: 404 });
  const { data: account } = await admin.from("ms_accounts").select("*").eq("id", msg.account_id).maybeSingle();
  if (!account) return NextResponse.json({ error: "no_account" }, { status: 400 });

  try {
    const token = await getValidAccessToken(account as any);
    // Sicherstellen, dass der aktuelle Text im Outlook-Entwurf steht, dann senden.
    const draftId = await createOrUpdateReplyDraft(token, msg.graph_id, msg.outlook_draft_id || null, msg.draft_body);
    await sendDraft(token, draftId);

    const sentAt = new Date().toISOString();
    await admin
      .from("messages")
      .update({
        draft_status: "gesendet",
        reply_sent_at: sentAt,
        needs_reply: false,
        outlook_draft_id: null // Entwurf ist nun gesendet
      })
      .eq("id", msg.id);

    return NextResponse.json({ ok: true, sentAt });
  } catch (e) {
    console.error("send failed:", (e as Error).message);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
}

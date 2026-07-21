import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidAccessToken } from "@/lib/tokens";
import { fetchThread, createOrUpdateReplyDraft } from "@/lib/graphMail";
import { refineDraft } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kurzer Bearbeitungsbefehl (Kürzer/Freundlicher/…) ODER manuell editierter Text.
// Verändert nur den Entwurf – sendet nicht.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { messageId, command, editedBody } = await req.json();
  const admin = supabaseAdmin();

  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg || !msg.draft_body) return NextResponse.json({ error: "no_draft" }, { status: 404 });
  const { data: account } = await admin.from("ms_accounts").select("*").eq("id", msg.account_id).maybeSingle();
  if (!account) return NextResponse.json({ error: "no_account" }, { status: 400 });

  try {
    const token = await getValidAccessToken(account as any);
    let body: string;
    if (editedBody != null) {
      body = editedBody; // manuelle Bearbeitung übernehmen
    } else {
      const thread = await fetchThread(token, msg.graph_id);
      const r = await refineDraft({ body: msg.draft_body, command, thread });
      body = r.body;
    }

    let outlookDraftId: string | null = msg.outlook_draft_id || null;
    try {
      outlookDraftId = await createOrUpdateReplyDraft(token, msg.graph_id, outlookDraftId, body);
    } catch (e) {
      console.error("Outlook draft update failed:", (e as Error).message);
    }

    await admin
      .from("messages")
      .update({ draft_body: body, outlook_draft_id: outlookDraftId, last_generated_at: new Date().toISOString() })
      .eq("id", msg.id);
    return NextResponse.json({ body });
  } catch (e) {
    console.error("refine failed:", (e as Error).message);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}

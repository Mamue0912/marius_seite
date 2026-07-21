import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidAccessToken } from "@/lib/tokens";
import { fetchThread, createOrUpdateReplyDraft } from "@/lib/graphMail";
import { generateDraft } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Erzeugt aus gewählter Reaktion ODER Freitext einen vollständigen Entwurf,
// speichert ihn im Cockpit UND als echten Outlook-Entwurf. Sendet NICHT.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { messageId, intent, intentLabel, customInstruction, tone } = await req.json();
  const admin = supabaseAdmin();

  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: account } = await admin.from("ms_accounts").select("*").eq("id", msg.account_id).maybeSingle();
  if (!account) return NextResponse.json({ error: "no_account" }, { status: 400 });

  try {
    const token = await getValidAccessToken(account as any);
    const thread = await fetchThread(token, msg.graph_id);
    const draft = await generateDraft({ thread, intent, intentLabel, customInstruction, tone: tone || "Professionell" });

    // Echter Outlook-Entwurf (erscheint in Outlook unter "Entwürfe").
    let outlookDraftId: string | null = msg.outlook_draft_id || null;
    let outlookSynced = false;
    try {
      outlookDraftId = await createOrUpdateReplyDraft(token, msg.graph_id, outlookDraftId, draft.body);
      outlookSynced = true;
    } catch (e) {
      console.error("Outlook draft failed (nur lokal gespeichert):", (e as Error).message);
    }

    await admin
      .from("messages")
      .update({
        selected_reply_intent: intent || "custom",
        custom_instruction: customInstruction || null,
        draft_body: draft.body,
        draft_subject: draft.subject,
        draft_language: draft.language,
        draft_tone: draft.tone,
        draft_binding: draft.binding,
        draft_needs_attachment: draft.needs_attachment,
        draft_missing_info: draft.missing_info,
        draft_status: "entwurf",
        outlook_draft_id: outlookDraftId,
        last_generated_at: new Date().toISOString()
      })
      .eq("id", msg.id);

    return NextResponse.json({ draft, outlookSynced });
  } catch (e) {
    console.error("generate failed:", (e as Error).message);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { buildThreadContext } from "@/lib/imapFetch";
import { generateDraft } from "@/lib/anthropic";
import { accountContextLine } from "@/lib/accountContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Erzeugt aus Reaktion oder Freitext einen Entwurf. Speichert im Cockpit.
// Sendet NICHT. Berücksichtigt, über welches eigene Konto die Mail kam.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { messageId, intent, intentLabel, customInstruction, tone } = await req.json();
  const admin = supabaseAdmin();

  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const account = msg.mail_account_id ? await loadMailAccount(msg.mail_account_id) : null;
  if (!account) return NextResponse.json({ error: "no_account" }, { status: 400 });

  try {
    const thread = await buildThreadContext(account as MailAccount, msg);
    const draft = await generateDraft({
      thread, intent, intentLabel, customInstruction,
      tone: tone || "Professionell",
      accountContext: accountContextLine(account as MailAccount)
    });

    await admin.from("messages").update({
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
      last_generated_at: new Date().toISOString()
    }).eq("id", msg.id);

    return NextResponse.json({ draft, fromAccount: { email: (account as any).email, provider: (account as any).provider } });
  } catch (e) {
    console.error("generate failed:", (e as Error).message);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}

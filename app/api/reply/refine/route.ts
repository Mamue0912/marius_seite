import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { buildThreadContext } from "@/lib/imapFetch";
import { refineDraft } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kurzer Bearbeitungsbefehl (Kürzer/Freundlicher/…) ODER manuell editierter Text.
// Verändert nur den Entwurf – sendet nicht.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { messageId, command, editedBody } = await req.json();
  const admin = supabaseAdmin();

  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg || !msg.draft_body) return NextResponse.json({ error: "no_draft" }, { status: 404 });

  try {
    let body: string;
    if (editedBody != null) {
      body = editedBody; // manuelle Bearbeitung direkt übernehmen
    } else {
      const account = msg.mail_account_id ? await loadMailAccount(msg.mail_account_id) : null;
      const thread = account ? await buildThreadContext(account as MailAccount, msg) : [];
      const r = await refineDraft({ body: msg.draft_body, command, thread });
      body = r.body;
    }

    await admin.from("messages")
      .update({ draft_body: body, last_generated_at: new Date().toISOString() })
      .eq("id", msg.id);
    return NextResponse.json({ body });
  } catch (e) {
    console.error("refine failed:", (e as Error).message);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}

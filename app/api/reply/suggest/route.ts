import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { buildThreadContext } from "@/lib/imapFetch";
import { generateSuggestions } from "@/lib/anthropic";
import { accountContextLine } from "@/lib/accountContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Drei kontextabhängige Antwortvorschläge (mit Konto-Kontext), gecacht.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { messageId } = await req.json();
  const admin = supabaseAdmin();

  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (msg.suggested_replies && msg.last_generated_at && Date.now() - new Date(msg.last_generated_at).getTime() < 864e5) {
    return NextResponse.json({ suggestions: msg.suggested_replies, language: msg.draft_language || null });
  }

  const account = msg.mail_account_id ? await loadMailAccount(msg.mail_account_id) : null;
  if (!account) return NextResponse.json({ error: "no_account" }, { status: 400 });

  try {
    const thread = await buildThreadContext(account as MailAccount, msg);
    const { language, suggestions } = await generateSuggestions(thread, accountContextLine(account as MailAccount));
    await admin.from("messages")
      .update({ suggested_replies: suggestions, draft_language: language, last_generated_at: new Date().toISOString() })
      .eq("id", msg.id);
    return NextResponse.json({ suggestions, language });
  } catch (e) {
    console.error("suggest failed:", (e as Error).message);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}

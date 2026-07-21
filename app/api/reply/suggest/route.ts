import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidAccessToken } from "@/lib/tokens";
import { fetchThread } from "@/lib/graphMail";
import { generateSuggestions } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Erzeugt (und cacht) drei kontextabhängige Antwortvorschläge für eine Mail.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { messageId } = await req.json();
  const admin = supabaseAdmin();

  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Cache: wenn vorhanden und < 24h alt, direkt zurück.
  if (msg.suggested_replies && msg.last_generated_at && Date.now() - new Date(msg.last_generated_at).getTime() < 864e5) {
    return NextResponse.json({ suggestions: msg.suggested_replies, language: msg.draft_language || null });
  }

  const { data: account } = await admin.from("ms_accounts").select("*").eq("id", msg.account_id).maybeSingle();
  if (!account) return NextResponse.json({ error: "no_account" }, { status: 400 });

  try {
    const token = await getValidAccessToken(account as any);
    const thread = await fetchThread(token, msg.graph_id);
    const { language, suggestions } = await generateSuggestions(thread);
    await admin
      .from("messages")
      .update({ suggested_replies: suggestions, draft_language: language, last_generated_at: new Date().toISOString() })
      .eq("id", msg.id);
    return NextResponse.json({ suggestions, language });
  } catch (e) {
    console.error("suggest failed:", (e as Error).message);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manuelle Kategorie-Korrektur für eine Nachricht (Nutzer-Vorrang).
// Optional: als Dauerregel für Absender/Domain speichern; oder ausblenden.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { messageId, category, hidden, ruleScope, needs_reply, user_labels } = await req.json();
  const admin = supabaseAdmin();

  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Nutzer-Override hat höchste Priorität und bleibt bei Re-Sync erhalten.
  const update: any = { classification_source: "user_override", classification_confidence: 1, override_updated_at: new Date().toISOString() };
  if (category != null) { update.semantic_category = category; update.user_category_override = category; }
  if (hidden != null) update.hidden = !!hidden;
  if (needs_reply != null) {
    update.needs_reply = !!needs_reply;
    update.user_needs_reply = !!needs_reply;
    update.action_status = needs_reply ? "reply_required" : "no_action";
    update.user_action_status = needs_reply ? "reply_required" : "no_action";
  }
  if (Array.isArray(user_labels)) update.user_labels = user_labels;
  await admin.from("messages").update(update).eq("id", msg.id);

  // Optionale Dauerregel (Absender/Domain immer diese Kategorie / ausblenden).
  if (ruleScope && (ruleScope === "sender" || ruleScope === "domain") && msg.from_address) {
    const value = ruleScope === "sender"
      ? String(msg.from_address).toLowerCase()
      : String(msg.from_address).toLowerCase().split("@")[1] || "";
    if (value) {
      await admin.from("mail_rules").upsert({
        user_id: user.id, match_type: ruleScope, match_value: value,
        set_category: category || null, set_hidden: !!hidden
      }, { onConflict: "user_id,match_type,match_value" });
    }
  }

  return NextResponse.json({ ok: true });
}

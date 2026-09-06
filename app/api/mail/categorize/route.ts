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
  const body = await req.json().catch(() => null);
  if (!body || typeof body.messageId !== "string") return NextResponse.json({ error: "bad_request", message: "Keine Nachricht ausgewählt." }, { status: 400 });
  const { messageId, category, hidden, ruleScope, needs_reply, user_labels, relevance, message_type, ruleLabel, ruleNeverReply, answered } = body;
  const admin = supabaseAdmin();

  const { data: message, error: messageError } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (messageError) return NextResponse.json({ error: "db_error", message: "Die Nachricht konnte nicht geladen werden." }, { status: 500 });
  if (!message) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Nutzer-Override hat höchste Priorität und bleibt bei Re-Sync/Neu-Einordnung erhalten.
  const update: Record<string, unknown> = { classification_source: "user_override", classification_confidence: 1, override_updated_at: new Date().toISOString() };
  if (category != null) { update.semantic_category = String(category).slice(0, 100); update.user_category_override = String(category).slice(0, 100); }
  if (hidden != null) update.hidden = !!hidden;
  if (relevance != null) { update.relevance = String(relevance).slice(0, 50); update.user_relevance = String(relevance).slice(0, 50); }
  if (message_type != null) { update.message_type = String(message_type).slice(0, 50); update.user_message_type = String(message_type).slice(0, 50); }
  if (needs_reply != null) {
    update.needs_reply = !!needs_reply;
    update.user_needs_reply = !!needs_reply;
    update.action_status = needs_reply ? "reply_required" : "no_action";
    update.user_action_status = needs_reply ? "reply_required" : "no_action";
  }
  // Manuell als beantwortet / wieder offen markieren.
  if (answered != null) {
    if (answered) {
      update.draft_status = "gesendet";
      update.reply_sent_at = new Date().toISOString();
      update.needs_reply = false;
      update.user_needs_reply = false;
      update.action_status = "no_action";
      update.user_action_status = "no_action";
    } else {
      update.draft_status = null;
      update.reply_sent_at = null;
      update.needs_reply = true;
      update.user_needs_reply = true;
      update.action_status = "reply_required";
      update.user_action_status = "reply_required";
    }
  }
  if (Array.isArray(user_labels)) update.user_labels = user_labels.filter((label: unknown) => typeof label === "string" && label.trim()).slice(0, 30).map((label: string) => label.trim().slice(0, 100));
  const { error: updateError } = await admin.from("messages").update(update).eq("id", message.id).eq("user_id", user.id);
  if (updateError) return NextResponse.json({ error: "db_error", message: "Die Änderung konnte nicht gespeichert werden." }, { status: 500 });

  let warning: string | undefined;
  // Optionale Dauerregeln (Absender/Domain: immer Kategorie/Label / nie antwortpflichtig / ausblenden).
  if (["sender", "domain"].includes(ruleScope) && message.from_address) {
    const value = ruleScope === "sender"
      ? String(message.from_address).toLowerCase()
      : String(message.from_address).toLowerCase().split("@")[1] || "";
    if (value) {
      const rule: Record<string, unknown> = { user_id: user.id, match_type: ruleScope, match_value: value };
      if (category != null) rule.set_category = String(category).slice(0, 100);
      if (hidden != null) rule.set_hidden = !!hidden;
      if (ruleLabel) rule.set_label = String(ruleLabel).slice(0, 100);
      if (ruleNeverReply === true) rule.set_needs_reply = false;
      if (ruleNeverReply === false) rule.set_needs_reply = true;
      const { error } = await admin.from("mail_rules").upsert(rule, { onConflict: "user_id,match_type,match_value" });
      if (error) warning = "Die Nachricht wurde aktualisiert, die Dauerregel konnte aber nicht gespeichert werden.";
    }
  }

  return NextResponse.json({ ok: true, warning });
}
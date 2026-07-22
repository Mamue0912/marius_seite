import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nutzer-Sortierregeln verwalten (Vorrang vor der KI).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabaseAdmin().from("mail_rules").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  return NextResponse.json({ rules: data || [] });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  const match_type = String(b.match_type || "");
  const match_value = String(b.match_value || "").trim().toLowerCase();
  if (!["sender", "domain", "account"].includes(match_type) || !match_value) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const admin = supabaseAdmin();
  const rule: any = { user_id: user.id, match_type, match_value };
  if (b.set_category !== undefined) rule.set_category = b.set_category || null;
  if (b.set_hidden !== undefined) rule.set_hidden = !!b.set_hidden;
  if (b.set_label !== undefined) rule.set_label = b.set_label || null;
  if (b.set_needs_reply !== undefined) rule.set_needs_reply = b.set_needs_reply === null ? null : !!b.set_needs_reply;
  const { data, error } = await admin.from("mail_rules").upsert(rule, { onConflict: "user_id,match_type,match_value" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Vorhandene passende Nachrichten sofort nachziehen.
  const patch: any = { classification_source: "rule", classification_confidence: 1 };
  if (b.set_category) patch.semantic_category = b.set_category;
  if (b.set_hidden) patch.hidden = true;
  if (b.set_needs_reply === false) { patch.needs_reply = false; patch.user_needs_reply = false; patch.action_status = "no_action"; }
  if (b.set_needs_reply === true) { patch.needs_reply = true; patch.user_needs_reply = true; patch.action_status = "reply_required"; }
  const q = admin.from("messages").update(patch).eq("user_id", user.id);
  if (match_type === "sender") await q.eq("from_address", match_value);
  else if (match_type === "domain") await q.ilike("from_address", `%@${match_value}`);
  else if (match_type === "account") await q.eq("mail_account_id", match_value);
  // set_label auf vorhandene Nachrichten anzuwenden (Array-Append) ist über die
  // Standard-Update-API nicht sauber möglich – neue Mails erhalten das Label
  // über die Regel beim Sync; bestehende über „Alles neu einordnen".

  return NextResponse.json({ rule: data });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await supabaseAdmin().from("mail_rules").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

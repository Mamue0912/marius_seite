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
  const { data, error } = await admin.from("mail_rules").upsert({
    user_id: user.id, match_type, match_value,
    set_category: b.set_category || null, set_hidden: !!b.set_hidden
  }, { onConflict: "user_id,match_type,match_value" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Vorhandene passende Nachrichten sofort nachziehen.
  const q = admin.from("messages").update({
    semantic_category: b.set_category || undefined,
    hidden: b.set_hidden ? true : undefined,
    classification_source: "rule",
    classification_confidence: 1
  }).eq("user_id", user.id);
  if (match_type === "sender") await q.eq("from_address", match_value);
  else if (match_type === "domain") await q.ilike("from_address", `%@${match_value}`);
  else if (match_type === "account") await q.eq("mail_account_id", match_value);

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

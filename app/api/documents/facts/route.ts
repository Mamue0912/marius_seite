import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Zentrale, dokumentübergreifende Fakten über den Nutzer (bearbeitbar).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabaseAdmin()
    .from("app_document_facts")
    .select("id,category,value,status,source,document_id,created_at")
    .eq("user_id", user.id)
    .order("category", { ascending: true }).order("created_at", { ascending: true });
  return NextResponse.json({ facts: data || [] });
}

// Neuen eigenen Fakt anlegen (direkt bestätigt).
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const value = String(b.value || "").trim();
  if (!value) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("app_document_facts").insert({
    user_id: user.id, document_id: null, category: b.category || "sonstiges",
    value, status: "bestaetigt", source: "manuell"
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ fact: data });
}

// Fakt bearbeiten (Wert/Kategorie/Status).
export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const update: any = {};
  if (typeof b.value === "string") update.value = b.value.trim();
  if (typeof b.category === "string") update.category = b.category;
  if (typeof b.status === "string") update.status = b.status;
  if (!Object.keys(update).length) return NextResponse.json({ ok: true });
  await supabaseAdmin().from("app_document_facts").update(update).eq("id", b.id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  await supabaseAdmin().from("app_document_facts").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

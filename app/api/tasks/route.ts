import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabaseAdmin().from("tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  return NextResponse.json({ tasks: data || [] });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  if (!b.title?.trim()) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { data, error } = await supabaseAdmin().from("tasks").insert({
    user_id: user.id, title: String(b.title).trim(), note: b.note || null,
    priority: b.priority || "normal", due_at: b.due_at || null,
    status: b.status || "offen", source: b.source || "manuell", linked_message_id: b.linked_message_id || null
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const patch: any = { updated_at: new Date().toISOString() };
  for (const k of ["title", "note", "priority", "due_at", "status"]) if (k in b) patch[k] = b[k];
  const { data } = await supabaseAdmin().from("tasks").update(patch).eq("id", b.id).eq("user_id", user.id).select().single();
  return NextResponse.json({ task: data });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await req.json();
  await supabaseAdmin().from("tasks").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

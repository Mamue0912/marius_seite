import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: vollständiges Bewerbungsprojekt (Bewerbung + Chat + Entwürfe + zugeordnete Unterlagen).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: app } = await admin.from("applications").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [{ data: messages }, { data: docs }, { data: links }] = await Promise.all([
    admin.from("application_messages").select("*").eq("application_id", app.id).order("created_at", { ascending: true }),
    admin.from("application_docs").select("*").eq("application_id", app.id).order("updated_at", { ascending: false }),
    admin.from("application_documents").select("document_id").eq("application_id", app.id)
  ]);
  const docIds = (links || []).map((l) => l.document_id);
  let assigned: any[] = [];
  if (docIds.length) {
    const { data } = await admin.from("app_documents").select("id,name,doc_type,mime,allowed_for_applications").in("id", docIds);
    assigned = data || [];
  }
  return NextResponse.json({ application: app, messages: messages || [], generatedDocs: docs || [], assignedDocuments: assigned });
}

// PATCH: Felder aktualisieren (Status, Firma, Position, Frist, Kontakt).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: app } = await admin.from("applications").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const update: any = { updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() };
  for (const k of ["company", "position", "job_type", "deadline", "contact", "status"]) {
    if (body[k] !== undefined) update[k] = body[k] === "" ? null : body[k];
  }
  // Eingefügtes Stellenangebot / gespeicherten Link + Analyse entfernen,
  // ohne das ganze Projekt zu löschen.
  if (body.clearJob === true) {
    update.job_url = null; update.job_text = null; update.analysis = null; update.job_source = null;
    update.status = "interessant";
  }
  await admin.from("applications").update(update).eq("id", app.id);
  return NextResponse.json({ ok: true });
}

// DELETE: Bewerbungsprojekt entfernen (Chat/Entwürfe/Zuordnungen via FK-Cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: app } = await admin.from("applications").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await admin.from("applications").delete().eq("id", app.id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

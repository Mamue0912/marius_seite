import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dbFailure(message = "Daten konnten nicht gespeichert werden.") {
  return NextResponse.json({ error: "db_error", message }, { status: 500 });
}

// GET: vollständiges Bewerbungsprojekt (Bewerbung + Chat + Entwürfe + zugeordnete Unterlagen).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: application, error: applicationError } = await admin.from("applications").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (applicationError) return dbFailure("Die Bewerbung konnte nicht geladen werden.");
  if (!application) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [messageResult, documentResult, linkResult] = await Promise.all([
    admin.from("application_messages").select("*").eq("application_id", application.id).eq("user_id", user.id).order("created_at", { ascending: true }),
    admin.from("application_docs").select("*").eq("application_id", application.id).eq("user_id", user.id).order("updated_at", { ascending: false }),
    admin.from("application_documents").select("document_id").eq("application_id", application.id).eq("user_id", user.id)
  ]);
  if (messageResult.error || documentResult.error || linkResult.error) return dbFailure("Bewerbungsdetails konnten nicht vollständig geladen werden.");

  const documentIds = (linkResult.data || []).map((link) => link.document_id);
  let assignedDocuments: any[] = [];
  if (documentIds.length) {
    const { data, error } = await admin.from("app_documents").select("id,name,doc_type,mime,allowed_for_applications").eq("user_id", user.id).in("id", documentIds);
    if (error) return dbFailure("Zugeordnete Unterlagen konnten nicht geladen werden.");
    assignedDocuments = data || [];
  }
  return NextResponse.json({
    application,
    messages: messageResult.data || [],
    generatedDocs: documentResult.data || [],
    assignedDocuments
  });
}

// PATCH: Felder aktualisieren (Status, Firma, Position, Frist, Kontakt).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: application, error: lookupError } = await admin.from("applications").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (lookupError) return dbFailure("Die Bewerbung konnte nicht geprüft werden.");
  if (!application) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_request", message: "Ungültige Eingabe." }, { status: 400 });
  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString() };
  for (const key of ["company", "position", "job_type", "deadline", "contact", "status"]) {
    if (body[key] !== undefined) update[key] = body[key] === "" ? null : body[key];
  }
  // Eingefügtes Stellenangebot / gespeicherten Link + Analyse entfernen,
  // ohne das ganze Projekt zu löschen.
  if (body.clearJob === true) {
    update.job_url = null;
    update.job_text = null;
    update.analysis = null;
    update.job_source = null;
    update.status = "interessant";
  }
  const { error } = await admin.from("applications").update(update).eq("id", application.id).eq("user_id", user.id);
  if (error) return dbFailure("Die Bewerbung konnte nicht gespeichert werden.");
  return NextResponse.json({ ok: true });
}

// DELETE: Bewerbungsprojekt entfernen (Chat/Entwürfe/Zuordnungen via FK-Cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: application, error: lookupError } = await admin.from("applications").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (lookupError) return dbFailure("Die Bewerbung konnte nicht geprüft werden.");
  if (!application) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { error } = await admin.from("applications").delete().eq("id", application.id).eq("user_id", user.id);
  if (error) return dbFailure("Die Bewerbung konnte nicht gelöscht werden.");
  return NextResponse.json({ ok: true });
}
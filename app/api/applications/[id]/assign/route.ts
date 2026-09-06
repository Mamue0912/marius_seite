import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dbFailure(message: string) {
  return NextResponse.json({ error: "db_error", message }, { status: 500 });
}

// Unterlagen einer Bewerbung zuordnen / entfernen.
// POST { documentId, action: "add" | "remove" }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: application, error: applicationError } = await admin.from("applications").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (applicationError) return dbFailure("Die Bewerbung konnte nicht geprüft werden.");
  if (!application) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const documentId = typeof body?.documentId === "string" ? body.documentId : "";
  const action = body?.action;
  if (!documentId || !["add", "remove"].includes(action)) {
    return NextResponse.json({ error: "bad_request", message: "Ungültige Unterlagen-Zuordnung." }, { status: 400 });
  }
  const { data: document, error: documentError } = await admin.from("app_documents").select("id").eq("id", documentId).eq("user_id", user.id).maybeSingle();
  if (documentError) return dbFailure("Die Unterlage konnte nicht geprüft werden.");
  if (!document) return NextResponse.json({ error: "doc_not_found" }, { status: 404 });

  const result = action === "remove"
    ? await admin.from("application_documents").delete().eq("application_id", application.id).eq("document_id", documentId).eq("user_id", user.id)
    : await admin.from("application_documents").upsert({ application_id: application.id, document_id: documentId, user_id: user.id }, { onConflict: "application_id,document_id" });
  if (result.error) return dbFailure("Die Unterlagen-Zuordnung konnte nicht gespeichert werden.");

  // Der Zeitstempel ist ergänzend; die erfolgreiche Zuordnung bleibt auch dann gültig,
  // wenn seine Aktualisierung vorübergehend fehlschlägt.
  const { error: touchError } = await admin.from("applications").update({ last_activity_at: new Date().toISOString() }).eq("id", application.id).eq("user_id", user.id);
  return NextResponse.json({ ok: true, warning: touchError ? "activity_timestamp_failed" : undefined });
}
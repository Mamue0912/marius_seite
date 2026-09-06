import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Führt zwei Bewerbungen zusammen, die dieselbe Stelle betreffen: verschiebt
// Chatverlauf, erstellte Dokumente und zugeordnete Unterlagen von der Quelle in
// die Zielbewerbung, füllt fehlende Felder der Zielbewerbung aus der Quelle und
// löscht anschließend die Quelle. Beide müssen dem Nutzer gehören.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { targetId, sourceId } = await req.json().catch(() => ({}));
  if (!targetId || !sourceId || targetId === sourceId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: apps, error: applicationsError } = await admin.from("applications").select("*").eq("user_id", user.id).in("id", [targetId, sourceId]);
  if (applicationsError) return NextResponse.json({ error: "db_error", message: "Bewerbungen konnten nicht geladen werden." }, { status: 500 });
  const target = (apps || []).find((a) => a.id === targetId);
  const source = (apps || []).find((a) => a.id === sourceId);
  if (!target || !source) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Fehlende Felder der Zielbewerbung aus der Quelle ergänzen (nichts überschreiben).
  const fill: any = {};
  for (const k of ["company", "position", "job_type", "job_url", "job_source", "job_text", "analysis", "deadline", "contact"] as const) {
    const tv = (target as any)[k];
    if ((tv === null || tv === undefined || tv === "") && (source as any)[k] != null) fill[k] = (source as any)[k];
  }
  if (Object.keys(fill).length) {
    fill.last_activity_at = new Date().toISOString();
    const { error } = await admin.from("applications").update(fill).eq("id", targetId).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "db_error", message: "Zieldaten konnten nicht ergänzt werden." }, { status: 500 });
  }

  // Kinddaten von der Quelle auf das Ziel umhängen. Jeder Schritt ist
  // wiederholbar; bei einem Fehler bleibt die Quelle für einen sicheren Retry bestehen.
  const { error: messagesError } = await admin.from("application_messages").update({ application_id: targetId }).eq("application_id", sourceId).eq("user_id", user.id);
  if (messagesError) return NextResponse.json({ error: "db_error", message: "Der Chatverlauf konnte nicht übernommen werden." }, { status: 500 });
  const { error: documentsError } = await admin.from("application_docs").update({ application_id: targetId }).eq("application_id", sourceId).eq("user_id", user.id);
  if (documentsError) return NextResponse.json({ error: "db_error", message: "Erstellte Dokumente konnten nicht übernommen werden." }, { status: 500 });

  // Zuordnungen (PK application_id+document_id): Nur ein echter Duplikatkonflikt
  // darf durch Entfernen der überflüssigen Quell-Zuordnung aufgelöst werden.
  const { data: links, error: linksError } = await admin.from("application_documents").select("document_id").eq("application_id", sourceId).eq("user_id", user.id);
  if (linksError) return NextResponse.json({ error: "db_error", message: "Unterlagen-Zuordnungen konnten nicht geladen werden." }, { status: 500 });
  for (const link of links || []) {
    const { error } = await admin.from("application_documents").update({ application_id: targetId }).eq("application_id", sourceId).eq("document_id", link.document_id).eq("user_id", user.id);
    if (!error) continue;
    if (error.code !== "23505") return NextResponse.json({ error: "db_error", message: "Eine Unterlagen-Zuordnung konnte nicht übernommen werden." }, { status: 500 });
    const { error: duplicateDeleteError } = await admin.from("application_documents").delete().eq("application_id", sourceId).eq("document_id", link.document_id).eq("user_id", user.id);
    if (duplicateDeleteError) return NextResponse.json({ error: "db_error", message: "Eine doppelte Unterlagen-Zuordnung konnte nicht bereinigt werden." }, { status: 500 });
  }

  // Quelle erst löschen, nachdem alle Kinddaten nachweislich übernommen wurden.
  const { error: sourceDeleteError } = await admin.from("applications").delete().eq("id", sourceId).eq("user_id", user.id);
  if (sourceDeleteError) return NextResponse.json({ error: "db_error", message: "Die zusammengeführte Quellbewerbung konnte nicht entfernt werden." }, { status: 500 });

  return NextResponse.json({ ok: true, applicationId: targetId });
}

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
  const { data: apps } = await admin.from("applications").select("*").eq("user_id", user.id).in("id", [targetId, sourceId]);
  const target = (apps || []).find((a) => a.id === targetId);
  const source = (apps || []).find((a) => a.id === sourceId);
  if (!target || !source) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Fehlende Felder der Zielbewerbung aus der Quelle ergänzen (nichts überschreiben).
  const fill: any = {};
  for (const k of ["company", "position", "job_type", "job_url", "job_source", "job_text", "analysis", "deadline", "contact"] as const) {
    const tv = (target as any)[k];
    if ((tv === null || tv === undefined || tv === "") && (source as any)[k] != null) fill[k] = (source as any)[k];
  }
  if (Object.keys(fill).length) { fill.last_activity_at = new Date().toISOString(); await admin.from("applications").update(fill).eq("id", targetId); }

  // Kinddaten von der Quelle auf das Ziel umhängen.
  await admin.from("application_messages").update({ application_id: targetId }).eq("application_id", sourceId).eq("user_id", user.id);
  await admin.from("application_docs").update({ application_id: targetId }).eq("application_id", sourceId).eq("user_id", user.id);
  // Zuordnungen (PK application_id+document_id): Konflikte einzeln behandeln.
  const { data: links } = await admin.from("application_documents").select("document_id").eq("application_id", sourceId).eq("user_id", user.id);
  for (const l of links || []) {
    const { error } = await admin.from("application_documents").update({ application_id: targetId }).eq("application_id", sourceId).eq("document_id", l.document_id).eq("user_id", user.id);
    // Existiert die Zuordnung im Ziel bereits, schlägt das Update wegen PK fehl → Quelle-Zuordnung entfernen.
    if (error) await admin.from("application_documents").delete().eq("application_id", sourceId).eq("document_id", l.document_id).eq("user_id", user.id);
  }

  // Quelle löschen (Kinder sind bereits umgehängt).
  await admin.from("applications").delete().eq("id", sourceId).eq("user_id", user.id);

  return NextResponse.json({ ok: true, applicationId: targetId });
}

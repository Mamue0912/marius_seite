import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refineText, aiConfigured, aiErrorInfo } from "@/lib/anthropic";
import { loadApplication, confirmedFactsText, jobContextText } from "@/lib/applicationContext";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kurze Anpassung eines erstellten Dokuments ODER manuelle Textbearbeitung.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { docId, command, editedBody } = await req.json().catch(() => ({}));
  if (!docId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: doc } = await admin.from("application_docs").select("*").eq("id", docId).eq("user_id", user.id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Manuelle Bearbeitung: direkt speichern, kein KI-Aufruf.
  if (editedBody != null) {
    await admin.from("application_docs").update({ body: editedBody, updated_at: new Date().toISOString() }).eq("id", doc.id);
    return NextResponse.json({ body: editedBody });
  }

  if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });
  const app = await loadApplication(user.id, doc.application_id);
  const started = Date.now();
  try {
    const factsText = await confirmedFactsText(user.id);
    const { body } = await refineText({ body: doc.body, command, jobContext: app ? jobContextText(app) : "", factsText });
    await admin.from("application_docs").update({ body, updated_at: new Date().toISOString() }).eq("id", doc.id);
    await recordAiEvent({ userId: user.id, kind: "refine", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: doc.kind });
    return NextResponse.json({ body });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "refine", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: doc.kind });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

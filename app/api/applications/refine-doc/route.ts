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
  const body = await req.json().catch(() => null);
  const docId = typeof body?.docId === "string" ? body.docId : "";
  if (!docId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const admin = supabaseAdmin();
  const { data: document, error: lookupError } = await admin.from("application_docs").select("*").eq("id", docId).eq("user_id", user.id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "db_error", message: "Das Dokument konnte nicht geladen werden." }, { status: 500 });
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Manuelle Bearbeitung: direkt speichern, kein KI-Aufruf.
  if (body.editedBody != null) {
    if (typeof body.editedBody !== "string" || body.editedBody.length > 100_000) {
      return NextResponse.json({ error: "bad_request", message: "Der Dokumenttext ist ungültig oder zu lang." }, { status: 400 });
    }
    const { error } = await admin.from("application_docs").update({ body: body.editedBody, updated_at: new Date().toISOString() }).eq("id", document.id).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: "db_error", message: "Der Entwurf konnte nicht gespeichert werden." }, { status: 500 });
    return NextResponse.json({ body: body.editedBody });
  }

  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) return NextResponse.json({ error: "bad_request", message: "Keine Anpassung angegeben." }, { status: 400 });
  if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });
  const app = await loadApplication(user.id, document.application_id);
  const started = Date.now();
  try {
    const factsText = await confirmedFactsText(user.id);
    const { body: refinedBody } = await refineText({ body: document.body, command, jobContext: app ? jobContextText(app) : "", factsText });
    const { error } = await admin.from("application_docs").update({ body: refinedBody, updated_at: new Date().toISOString() }).eq("id", document.id).eq("user_id", user.id);
    if (error) {
      await recordAiEvent({ userId: user.id, kind: "refine", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: "database", subjectHint: document.kind });
      return NextResponse.json({ error: "db_error", message: "Der angepasste Entwurf konnte nicht gespeichert werden." }, { status: 500 });
    }
    await recordAiEvent({ userId: user.id, kind: "refine", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: document.kind });
    return NextResponse.json({ body: refinedBody });
  } catch (caught) {
    const info = aiErrorInfo(caught);
    await recordAiEvent({ userId: user.id, kind: "refine", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: document.kind });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}
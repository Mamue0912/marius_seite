import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateApplicationDocument, aiConfigured, aiErrorInfo } from "@/lib/anthropic";
import { loadApplication, confirmedFactsText, jobContextText, touchApplication } from "@/lib/applicationContext";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KINDS = ["anschreiben", "motivation", "bewerbungsmail", "kurzprofil", "gespraech"];

// Erstellt ein Bewerbungsdokument (Anschreiben usw.) aus Stelle + bestätigten
// Fakten. Speichert es der Bewerbung zugeordnet. DOCX per doc/[id]/docx.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });

  const { applicationId, kind, tone, instruction } = await req.json().catch(() => ({}));
  if (!applicationId || !KINDS.includes(kind)) return NextResponse.json({ error: "bad_request", message: "Ungültige Anfrage." }, { status: 400 });
  const app = await loadApplication(user.id, applicationId);
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const started = Date.now();
  try {
    const factsText = await confirmedFactsText(user.id);
    const doc = await generateApplicationDocument({
      kind, tone: tone || "professionell und natürlich",
      jobContext: jobContextText(app), factsText, instruction
    });
    const { data: saved, error } = await supabaseAdmin().from("application_docs").insert({
      user_id: user.id, application_id: app.id, kind, title: doc.title, body: doc.body, tone: tone || null
    }).select("*").single();
    if (error) return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
    await touchApplication(app.id);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: kind });
    return NextResponse.json({ doc: saved, missing_info: doc.missing_info });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: kind });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

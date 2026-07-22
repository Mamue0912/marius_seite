import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { applicationChatReply, aiConfigured, aiErrorInfo } from "@/lib/anthropic";
import { loadApplication, confirmedFactsText, jobContextText, generatedDocsContext, chatHistory, touchApplication } from "@/lib/applicationContext";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Durchgehender Bewerbungs-Chat. Kontext (Stelle + bestätigte Fakten +
// Entwürfe + Verlauf) wird serverseitig geladen – geht nie verloren.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });

  const { applicationId, message } = await req.json().catch(() => ({}));
  if (!applicationId || !message?.trim()) return NextResponse.json({ error: "bad_request", message: "Keine Nachricht." }, { status: 400 });
  const app = await loadApplication(user.id, applicationId);
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = supabaseAdmin();
  // Nutzernachricht speichern (Kontext bleibt erhalten).
  await admin.from("application_messages").insert({ user_id: user.id, application_id: app.id, role: "user", content: message.trim() });

  const started = Date.now();
  try {
    const [factsText, docsCtx, history] = await Promise.all([
      confirmedFactsText(user.id),
      generatedDocsContext(user.id, app.id),
      chatHistory(user.id, app.id, 20)
    ]);
    // Die eben gespeicherte Nachricht ist bereits in history enthalten → letzte entfernen.
    const prior = history.slice(0, -1);
    const reply = await applicationChatReply({
      jobContext: jobContextText(app), factsText, docsContext: docsCtx, history: prior, userMessage: message.trim()
    });
    const { data: saved } = await admin.from("application_messages").insert({ user_id: user.id, application_id: app.id, role: "assistant", content: reply }).select("*").single();
    await touchApplication(app.id);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: "chat:" + (app.position || "") });
    return NextResponse.json({ reply, message: saved });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: "chat" });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

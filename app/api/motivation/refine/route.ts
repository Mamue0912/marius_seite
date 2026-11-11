import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { aiConfigured, aiErrorInfo, refineMotivationParagraph } from "@/lib/anthropic";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { loadLetter, loadProfile, loadExamples } from "@/lib/motivationContext";
import { MOTIVATION_RULES, profileBlock, examplesBlock, programmeFactsBlock, REFINE_ACTIONS } from "@/lib/motivation";
import { modelFor } from "@/lib/aiModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// POST { letterId, paragraph, action | instruction }
//
// Gibt NUR den Vorschlag zurück und speichert NICHTS. Die Oberfläche zeigt
// Vorher/Nachher; erst die Übernahme schreibt über die PATCH-Route. So gehen
// manuelle Änderungen nie ungefragt verloren.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) {
    return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });
  }

  const payload = await req.json().catch(() => ({}));
  const letterId = typeof payload.letterId === "string" ? payload.letterId : "";
  const paragraph = typeof payload.paragraph === "string" ? payload.paragraph.trim() : "";
  if (!letterId || !paragraph) {
    return NextResponse.json({ error: "bad_request", message: "Absatz oder Schreiben fehlt." }, { status: 400 });
  }
  if (paragraph.length > 6000) {
    return NextResponse.json({ error: "too_large", message: "Der Absatz ist zu lang." }, { status: 413 });
  }

  const action = REFINE_ACTIONS.find((a) => a.key === payload.action);
  const custom = typeof payload.instruction === "string" ? payload.instruction.trim().slice(0, 500) : "";
  const instruction = action?.instruction || custom;
  if (!instruction) {
    return NextResponse.json({ error: "bad_request", message: "Keine Überarbeitungsanweisung angegeben." }, { status: 400 });
  }

  let letter, profile, examples;
  try {
    letter = await loadLetter(user.id, letterId);
    if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });
    profile = await loadProfile(user.id);
    examples = await loadExamples(user.id, letterId);
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }

  const started = Date.now();
  const model = modelFor("writing");
  try {
    const res = await refineMotivationParagraph({
      rules: MOTIVATION_RULES,
      language: letter.language === "en" ? "en" : "de",
      paragraph, instruction,
      profile: profileBlock(profile),
      examples: examplesBlock(examples),
      programmeFacts: programmeFactsBlock()
    });
    const suggestion = String(res.paragraph || "").trim();
    if (!suggestion) {
      return NextResponse.json({ error: "api_error", message: "Es wurde kein Vorschlag erzeugt. Bitte erneut versuchen." }, { status: 502 });
    }
    await recordAiEvent({ userId: user.id, kind: "refine", ok: true, durationMs: Date.now() - started, model, subjectHint: action?.key || "custom" });
    // before/after für den Vergleich vor der Übernahme.
    return NextResponse.json({ before: paragraph, after: suggestion, note: res.note || null });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "refine", ok: false, durationMs: Date.now() - started, model, errorCategory: info.category });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

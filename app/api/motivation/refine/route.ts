import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { aiConfigured, aiErrorInfo, refineMotivationParagraph, refineMotivationTargeted } from "@/lib/anthropic";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { loadLetter, loadProfile, loadExamples, loadSourceMaterial } from "@/lib/motivationContext";
import {
  MOTIVATION_RULES, profileBlock, examplesBlock, programmeFactsBlock,
  sourceMaterialBlock, paragraphs, REFINE_ACTIONS
} from "@/lib/motivation";
import { modelFor } from "@/lib/aiModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Zwei Betriebsarten – beide speichern NICHTS. Die Oberfläche zeigt
// Vorher/Nachher; erst die Übernahme schreibt über die PATCH-Route.
// Dadurch gehen manuelle Änderungen nie ungefragt verloren.
//
// 1) Absatzweise:  { letterId, paragraph, action|instruction }
//    -> { before, after, note }
//
// 2) Gezielt per Freitext: { letterId, body, instruction }
//    -> { targeted: true, changes: [{ index, before, after, reason }], note }
//    Die KI entscheidet selbst, welche Absätze der Wunsch betrifft, und
//    fasst nur diese an.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) {
    return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });
  }

  const payload = await req.json().catch(() => ({}));
  const letterId = typeof payload.letterId === "string" ? payload.letterId : "";
  if (!letterId) return NextResponse.json({ error: "bad_request", message: "Kein Schreiben angegeben." }, { status: 400 });

  const action = REFINE_ACTIONS.find((a) => a.key === payload.action);
  const custom = typeof payload.instruction === "string" ? payload.instruction.trim().slice(0, 800) : "";
  const instruction = action?.instruction || custom;
  if (!instruction) {
    return NextResponse.json({ error: "bad_request", message: "Bitte beschreibe, was geändert werden soll." }, { status: 400 });
  }

  let letter, profile, examples, source;
  try {
    letter = await loadLetter(user.id, letterId);
    if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });
    profile = await loadProfile(user.id);
    examples = await loadExamples(user.id, letterId);
    source = await loadSourceMaterial(user.id);
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }

  const language = letter.language === "en" ? "en" : "de";
  const started = Date.now();
  const model = modelFor("writing");
  const ctx = {
    rules: MOTIVATION_RULES, language: language as "de" | "en",
    profile: profileBlock(profile),
    examples: examplesBlock(examples),
    programmeFacts: programmeFactsBlock(),
    sourceMaterial: sourceMaterialBlock(source.factsText, source.documentsText)
  };

  try {
    // ---- Gezielt: ganzer Text, KI wählt die Stelle ----
    const bodyText = typeof payload.body === "string" ? payload.body : letter.body;
    if (!payload.paragraph) {
      const paras = paragraphs(bodyText);
      if (!paras.length) {
        return NextResponse.json({ error: "empty", message: "Es gibt noch keinen Text zum Ändern." }, { status: 400 });
      }
      if (bodyText.length > 60_000) {
        return NextResponse.json({ error: "too_large", message: "Der Text ist zu lang." }, { status: 413 });
      }
      const numbered = paras.map((p, i) => `[${i}] ${p}`).join("\n\n");
      const res = await refineMotivationTargeted({ ...ctx, numberedBody: numbered, instruction });

      const changes = (res.changes || [])
        .filter((c) => Number.isInteger(c.index) && c.index >= 0 && c.index < paras.length && String(c.paragraph || "").trim())
        .map((c) => ({
          index: c.index,
          before: paras[c.index],
          after: String(c.paragraph).trim(),
          reason: String(c.reason || "").slice(0, 300)
        }))
        // Unveränderte Absätze gar nicht erst anbieten.
        .filter((c) => c.after !== c.before);

      await recordAiEvent({ userId: user.id, kind: "refine", ok: true, durationMs: Date.now() - started, model, subjectHint: "targeted" });
      return NextResponse.json({
        targeted: true, changes, note: res.note || null,
        message: changes.length ? null : "Für diesen Wunsch wurde keine passende Stelle geändert."
      });
    }

    // ---- Absatzweise: genau der übergebene Absatz ----
    const paragraph = String(payload.paragraph).trim();
    if (paragraph.length > 6000) {
      return NextResponse.json({ error: "too_large", message: "Der Absatz ist zu lang." }, { status: 413 });
    }
    const res = await refineMotivationParagraph({ ...ctx, paragraph, instruction });
    const suggestion = String(res.paragraph || "").trim();
    if (!suggestion) {
      return NextResponse.json({ error: "api_error", message: "Es wurde kein Vorschlag erzeugt. Bitte erneut versuchen." }, { status: 502 });
    }
    await recordAiEvent({ userId: user.id, kind: "refine", ok: true, durationMs: Date.now() - started, model, subjectHint: action?.key || "custom" });
    return NextResponse.json({ before: paragraph, after: suggestion, note: res.note || null });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "refine", ok: false, durationMs: Date.now() - started, model, errorCategory: info.category });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

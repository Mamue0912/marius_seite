import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { aiConfigured, aiErrorInfo, generateMotivationOutline, generateMotivationDraft } from "@/lib/anthropic";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { loadLetter, loadProfile, loadExamples, saveVersion, loadSourceMaterial } from "@/lib/motivationContext";
import {
  MOTIVATION_RULES, profileBlock, examplesBlock, requirementsBlock,
  programmeFactsBlock, defaultOutline, sourceMaterialBlock
} from "@/lib/motivation";
import { modelFor } from "@/lib/aiModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { letterId, mode: "outline" | "draft" }
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) {
    return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });
  }

  const payload = await req.json().catch(() => ({}));
  const letterId = typeof payload.letterId === "string" ? payload.letterId : "";
  const mode = payload.mode === "draft" ? "draft" : "outline";
  if (!letterId) return NextResponse.json({ error: "bad_request", message: "Kein Schreiben angegeben." }, { status: 400 });

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

  try {
    if (mode === "outline") {
      const res = await generateMotivationOutline({
        rules: MOTIVATION_RULES, language,
        institution: letter.institution, programme: letter.programme,
        requirements: requirementsBlock(), programmeFacts: programmeFactsBlock(),
        profile: profileBlock(profile) + "\n\n" + sourceMaterialBlock(source.factsText, source.documentsText),
        examples: examplesBlock(examples)
      });
      const sections = (res.sections || []).slice(0, 8).map((s, i) => ({
        id: String(s.id || `s${i}`).slice(0, 40),
        heading: String(s.heading || "").slice(0, 200),
        intent: String(s.intent || "").slice(0, 600)
      }));
      const outline = sections.length ? sections : defaultOutline(language);
      const { error } = await supabaseAdmin().from("motivation_letters")
        .update({ outline, stage: "gliederung", updated_at: new Date().toISOString() })
        .eq("id", letter.id).eq("user_id", user.id);
      if (error) return NextResponse.json({ error: "db_error", message: "Die Gliederung konnte nicht gespeichert werden." }, { status: 500 });
      await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model, subjectHint: "motivation_outline" });
      return NextResponse.json({ outline, missing: res.missing || [], sources: { factCount: source.factCount, documents: source.documents } });
    }

    // Entwurf: vorhandenen Text vorher sichern (nichts geht verloren).
    if (letter.body.trim()) {
      await saveVersion(user.id, letter.id, letter.body, "Stand vor neuem Entwurf", "auto").catch(() => {});
    }

    const outlineRows: any[] = Array.isArray(letter.outline) && letter.outline.length ? letter.outline : defaultOutline(language);
    const outlineText = outlineRows.map((s: any, i: number) => `${i + 1}. ${s.heading}: ${s.intent}`).join("\n");

    const nameLine = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
    let identity = nameLine;
    if (profile.birthDate) {
      const [y, m, d] = String(profile.birthDate).slice(0, 10).split("-");
      identity = `${nameLine}, geboren am ${d}.${m}.${y}`.trim();
    }
    if (!identity) {
      // Nicht blockieren: die KI soll Name/Geburtsdatum aus den Unterlagen
      // übernehmen, falls dort vorhanden, sonst die Zeile weglassen und
      // den Mangel unter "missing" melden.
      identity = "(Name und Geburtsdatum aus den Unterlagen übernehmen; falls dort nicht auffindbar, Kopfzeile weglassen und unter missing melden)";
    }

    const res = await generateMotivationDraft({
      rules: MOTIVATION_RULES, language,
      institution: letter.institution, programme: letter.programme,
      requirements: requirementsBlock(), programmeFacts: programmeFactsBlock(),
      profile: profileBlock(profile) + "\n\n" + sourceMaterialBlock(source.factsText, source.documentsText),
      examples: examplesBlock(examples),
      outline: outlineText, identityLine: identity
    });

    const body = String(res.body || "").trim();
    if (!body) {
      await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model, errorCategory: "api_error", subjectHint: "motivation_draft" });
      return NextResponse.json({ error: "api_error", message: "Es wurde kein Text erzeugt. Bitte erneut versuchen." }, { status: 502 });
    }

    const { data, error } = await supabaseAdmin().from("motivation_letters")
      .update({ body, stage: "entwurf", updated_at: new Date().toISOString() })
      .eq("id", letter.id).eq("user_id", user.id).select("*").single();
    if (error) return NextResponse.json({ error: "db_error", message: "Der Entwurf konnte nicht gespeichert werden." }, { status: 500 });

    await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model, subjectHint: "motivation_draft" });
    return NextResponse.json({ letter: data, missing: res.missing || [], sources: { factCount: source.factCount, documents: source.documents } });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model, errorCategory: info.category, subjectHint: `motivation_${mode}` });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

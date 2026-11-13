import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { aiConfigured, aiErrorInfo, planMotivationNarrative, writeMotivationDraft } from "@/lib/anthropic";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import {
  loadLetter, loadProfile, loadExamples, saveVersion, loadSourceMaterial,
  loadEvidence, loadInterview, interviewBlock
} from "@/lib/motivationContext";
import { profileBlock, examplesBlock, defaultOutline } from "@/lib/motivation";
import { evidenceBlock, selectStories } from "@/lib/evidence";
import { profileById } from "@/lib/admissions";
import { evidenceDepthWarning } from "@/lib/qualityRubric";
import { CORE_RULES, admissionsBlock, dataBlock, toneInstruction, TONE_GUARD, PROMPT_VERSION } from "@/lib/prompts";
import { modelFor } from "@/lib/aiModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { letterId, mode: "plan" | "draft" | "full" }
//
// Pipeline:
//   plan  = Stufen B–D: Motive, Geschichtenauswahl, Argumentation
//   draft = Stufe E:     Entwurf entlang des Plans
//   full  = beides nacheinander (ein Klick)
//
// Die Prüfstufen (Review, Faktencheck, Interviewfestigkeit) laufen
// bewusst in einer eigenen Route, damit das Modell nicht im selben
// Durchgang seine eigene Arbeit bewertet.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) {
    return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });
  }

  const payload = await req.json().catch(() => ({}));
  const letterId = typeof payload.letterId === "string" ? payload.letterId : "";
  const mode = ["plan", "draft", "full", "outline"].includes(payload.mode) ? payload.mode : "full";
  if (!letterId) return NextResponse.json({ error: "bad_request", message: "Kein Schreiben angegeben." }, { status: 400 });

  let letter, profile, examples, source, evidence, interview;
  try {
    letter = await loadLetter(user.id, letterId);
    if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });
    [profile, examples, source, evidence, interview] = await Promise.all([
      loadProfile(user.id),
      loadExamples(user.id, letterId),
      loadSourceMaterial(user.id),
      loadEvidence(user.id),
      loadInterview(user.id, letterId)
    ]);
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }

  const adm = profileById((letter as any).profile_id);
  const language = letter.language === "en" ? "en" : "de";
  const started = Date.now();
  const model = modelFor("writing");

  // Alle Nutzerangaben als DATEN kapseln (Schutz vor Prompt Injection
  // aus importierten Unterlagen).
  const profileData = dataBlock(
    "PROFIL",
    [
      profileBlock(profile),
      source.factsText ? `\nBESTÄTIGTE ANGABEN:\n${source.factsText}` : "",
      source.documentsText ? `\nUNTERLAGEN:\n${source.documentsText}` : ""
    ].filter(Boolean).join("\n")
  );
  const evidenceData = dataBlock("ERFAHRUNGEN", evidenceBlock(evidence));
  const interviewData = dataBlock(
    "GESPRÄCHSANTWORTEN",
    [interviewBlock(interview), examplesBlock(examples)].filter((x) => x && !x.startsWith("(")).join("\n\n")
  );
  const admissions = admissionsBlock(adm);

  try {
    // ---------------- Stufen B–D: Plan ----------------
    let planText = "";
    let planMissing: string[] = [];
    if (mode === "plan" || mode === "outline" || mode === "full") {
      const preselected = selectStories(evidence)
        .map((s) => `- ${s.title}`)
        .join("\n");
      const plan = await planMotivationNarrative({
        rules: CORE_RULES, admissions, evidence: evidenceData,
        profile: profileData, interview: interviewData,
        language, preselected
      });
      planMissing = plan.missing || [];
      const sections = (plan.sections || []).slice(0, 8).map((s, i) => ({
        id: `s${i}`,
        heading: String(s.heading || "").slice(0, 200),
        intent: String(s.intent || "").slice(0, 600)
      }));
      const outline = sections.length ? sections : defaultOutline(language);
      planText = [
        `Kernargument: ${plan.coreArgument || "(offen)"}`,
        "",
        "Gewählte Erfahrungen:",
        ...(plan.stories || []).map((s) => `- ${s.title}: ${s.why} (Blickwinkel: ${s.angle})`),
        "",
        "Abschnitte:",
        ...outline.map((s, i) => `${i + 1}. ${s.heading}: ${s.intent}`)
      ].join("\n");

      const { error } = await supabaseAdmin().from("motivation_letters")
        .update({ outline, stage: mode === "full" ? "entwurf" : "gliederung", prompt_version: PROMPT_VERSION, updated_at: new Date().toISOString() })
        .eq("id", letter.id).eq("user_id", user.id);
      if (error) return NextResponse.json({ error: "db_error", message: "Der Plan konnte nicht gespeichert werden." }, { status: 500 });

      if (mode === "plan" || mode === "outline") {
        await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model, subjectHint: "motivation_plan" });
        return NextResponse.json({
          outline, plan: { coreArgument: plan.coreArgument, stories: plan.stories },
          missing: planMissing, sources: { factCount: source.factCount, documents: source.documents }
        });
      }
    }

    // ---------------- Stufe E: Entwurf ----------------
    if (letter.body.trim()) {
      await saveVersion(user.id, letter.id, letter.body, "Stand vor neuem Entwurf", "auto").catch(() => {});
    }
    if (!planText) {
      const rows: any[] = Array.isArray(letter.outline) && letter.outline.length ? letter.outline : defaultOutline(language);
      planText = rows.map((s: any, i: number) => `${i + 1}. ${s.heading}: ${s.intent}`).join("\n");
    }

    const nameLine = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
    let identity = nameLine;
    if (profile.birthDate) {
      const [y, m, d] = String(profile.birthDate).slice(0, 10).split("-");
      identity = `${nameLine}, geboren am ${d}.${m}.${y}`.trim();
    }
    if (!identity) {
      identity = "(Name und Geburtsdatum aus den Unterlagen übernehmen; falls dort nicht auffindbar, Kopfzeile weglassen und unter missing melden)";
    }

    const draft = await writeMotivationDraft({
      rules: CORE_RULES, admissions, evidence: evidenceData,
      profile: profileData, interview: interviewData,
      plan: planText, identityLine: identity,
      tone: toneInstruction((letter as any).tone), toneGuard: TONE_GUARD, language
    });

    const body = String(draft.body || "").trim();
    if (!body) {
      await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model, errorCategory: "api_error", subjectHint: "motivation_draft" });
      return NextResponse.json({ error: "api_error", message: "Es wurde kein Text erzeugt. Bitte erneut versuchen." }, { status: 502 });
    }

    const { data, error } = await supabaseAdmin().from("motivation_letters")
      .update({ body, stage: "entwurf", prompt_version: PROMPT_VERSION, updated_at: new Date().toISOString() })
      .eq("id", letter.id).eq("user_id", user.id).select("*").single();
    if (error) return NextResponse.json({ error: "db_error", message: "Der Entwurf konnte nicht gespeichert werden." }, { status: 500 });

    await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model, subjectHint: "motivation_draft" });
    return NextResponse.json({
      letter: data,
      missing: Array.from(new Set([...planMissing, ...(draft.missing || [])])),
      sources: { factCount: source.factCount, documents: source.documents },
      evidenceUsed: selectStories(evidence).map((s) => s.title),
      depth: evidenceDepthWarning(evidence)
    });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model, errorCategory: info.category, errorDetail: info.detail, subjectHint: `motivation_${mode}` });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  aiConfigured, aiErrorInfo, reviewMotivationDraft, factCheckMotivation, reviseWeakParagraphs
} from "@/lib/anthropic";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { loadLetter, loadProfile, loadEvidence } from "@/lib/motivationContext";
import { evidenceBlock, plannedTitles } from "@/lib/evidence";
import { profileById } from "@/lib/admissions";
import { admissionsBlock, dataBlock, toneInstruction, TONE_GUARD, CORE_RULES, PROMPT_VERSION } from "@/lib/prompts";
import { paragraphs } from "@/lib/motivation";
import {
  RUBRIC_DIMENSIONS, RUBRIC_DISCLAIMER, averageScore, complianceChecks, styleFindings,
  weakDimensions, genericFindings, evidenceDepthWarning, type RubricScore
} from "@/lib/qualityRubric";
import { buildMotivationPdf } from "@/lib/motivationPdf";
import { modelFor } from "@/lib/aiModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { letterId, body?, mode?: "review" | "factcheck" | "revise" }
//
// Die Prüfung läuft GETRENNT von der Erzeugung: eigener Aufruf, eigener
// Prompt, eigene Rolle. So bewertet das Modell nicht seine eigene Arbeit
// im selben Durchgang. Die Compliance-Prüfungen sind deterministisch.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => ({}));
  const letterId = typeof payload.letterId === "string" ? payload.letterId : "";
  const mode = ["factcheck", "revise"].includes(payload.mode) ? payload.mode : "review";
  if (!letterId) return NextResponse.json({ error: "bad_request", message: "Kein Schreiben angegeben." }, { status: 400 });

  let letter, profile, evidence;
  try {
    letter = await loadLetter(user.id, letterId);
    if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });
    profile = await loadProfile(user.id);
    evidence = await loadEvidence(user.id);
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }

  const body = typeof payload.body === "string" && payload.body.length <= 60_000 ? payload.body : letter.body;
  if (!body.trim()) return NextResponse.json({ error: "empty", message: "Es gibt noch keinen Text zum Prüfen." }, { status: 400 });

  const adm = profileById((letter as any).profile_id);
  const language = letter.language === "en" ? "en" : "de";
  const evBlock = dataBlock("ERFAHRUNGEN", evidenceBlock(evidence));
  const started = Date.now();
  const model = modelFor("writing");

  try {
    // ---------------- Faktencheck ----------------
    if (mode === "factcheck") {
      const res = await factCheckMotivation({
        evidence: evBlock, body,
        plannedTitles: plannedTitles(evidence).join(", "),
        language
      });
      await recordAiEvent({ userId: user.id, kind: "refine", ok: true, durationMs: Date.now() - started, model, subjectHint: "factcheck" });
      return NextResponse.json({ claims: res.claims || [], verdict: res.verdict || null });
    }

    // ---------------- Gezielte Revision ----------------
    if (mode === "revise") {
      const weaknesses = typeof payload.weaknesses === "string" ? payload.weaknesses.slice(0, 4000) : "";
      if (!weaknesses.trim()) {
        return NextResponse.json({ error: "bad_request", message: "Keine Schwachstellen angegeben." }, { status: 400 });
      }
      const paras = paragraphs(body);
      const numbered = paras.map((p, i) => `[${i}] ${p}`).join("\n\n");
      const res = await reviseWeakParagraphs({
        rules: CORE_RULES, admissions: admissionsBlock(adm), evidence: evBlock,
        numberedBody: numbered, weaknesses,
        tone: toneInstruction((letter as any).tone), toneGuard: TONE_GUARD, language
      });
      const changes = (res.changes || [])
        .filter((c) => Number.isInteger(c.index) && c.index >= 0 && c.index < paras.length && String(c.paragraph || "").trim())
        .map((c) => ({ index: c.index, before: paras[c.index], after: String(c.paragraph).trim(), reason: String(c.reason || "").slice(0, 300) }))
        .filter((c) => c.after !== c.before);
      await recordAiEvent({ userId: user.id, kind: "refine", ok: true, durationMs: Date.now() - started, model, subjectHint: "revise" });
      return NextResponse.json({ targeted: true, changes, note: res.note || null });
    }

    // ---------------- Vollständige Bewertung ----------------
    // Seitenzahl aus dem tatsächlichen Satz.
    let pages: number | null = null;
    try { pages = (await buildMotivationPdf({ body, maxPages: adm.maxPages })).pages; } catch { pages = null; }

    const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
    const compliance = complianceChecks({
      profile: adm, body, evidence, renderedPages: pages,
      hasName: !!(profile.firstName && profile.lastName && body.includes(profile.lastName || "")),
      hasBirthDate: !!profile.birthDate && /\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}|\d{4}-\d{2}-\d{2}/.test(body)
    });

    const dims = RUBRIC_DIMENSIONS.map((d) => `- ${d.key}: ${d.label}`).join("\n");
    const res = await reviewMotivationDraft({
      admissions: admissionsBlock(adm), evidence: evBlock, body, dimensions: dims, language
    });

    // Nur bekannte Dimensionen übernehmen, Punkte auf 0..10 begrenzen.
    const byKey = new Map(RUBRIC_DIMENSIONS.map((d) => [d.key, d.label]));
    const scores: RubricScore[] = (res.findings || [])
      .filter((f) => byKey.has(f.dimension as any))
      .map((f) => ({
        key: f.dimension as any,
        label: byKey.get(f.dimension as any) || f.dimension,
        score: Math.max(0, Math.min(10, Math.round(Number(f.score) || 0))),
        justification: String(f.justification || "").slice(0, 600),
        quote: f.quote ? String(f.quote).slice(0, 300) : null,
        suggestion: f.suggestion ? String(f.suggestion).slice(0, 400) : null
      }));

    const report = {
      scores,
      average: averageScore(scores),
      weak: weakDimensions(scores).map((s) => s.key),
      worstParagraphs: (res.worstParagraphs || []).filter((i) => Number.isInteger(i) && i >= 0).slice(0, 3),
      summary: String(res.summary || "").slice(0, 800),
      compliance,
      style: styleFindings(body),
      generic: genericFindings(body, [
        ...evidence.map((e) => e.title),
        profile.school || "", adm.institution, adm.programme,
        ...adm.curriculum.map((m) => m.name)
      ].filter(Boolean)),
      depth: evidenceDepthWarning(evidence),
      pages,
      disclaimer: RUBRIC_DISCLAIMER,
      promptVersion: PROMPT_VERSION,
      checkedAt: new Date().toISOString()
    };

    await supabaseAdmin().from("motivation_letters")
      .update({ last_review: report }).eq("id", letter.id).eq("user_id", user.id);
    await recordAiEvent({ userId: user.id, kind: "refine", ok: true, durationMs: Date.now() - started, model, subjectHint: "review" });
    return NextResponse.json(report);
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "refine", ok: false, durationMs: Date.now() - started, model, errorCategory: info.category, errorDetail: info.detail, subjectHint: mode });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

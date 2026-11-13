import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { aiConfigured, aiErrorInfo, nextInterviewQuestions } from "@/lib/anthropic";
import { loadEvidence, loadInterview, loadProfile, askedBlock, interviewBlock } from "@/lib/motivationContext";
import { evidenceBlock } from "@/lib/evidence";
import { profileById } from "@/lib/admissions";
import { admissionsBlock, dataBlock } from "@/lib/prompts";
import { profileBlock } from "@/lib/motivation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: Gesprächsstand mit Fortschritt.
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const letterId = new URL(req.url).searchParams.get("letter");
  try {
    const rows = await loadInterview(user.id, letterId);
    const answered = rows.filter((r) => r.state === "beantwortet").length;
    const skipped = rows.filter((r) => r.state === "uebersprungen").length;
    return NextResponse.json({
      rows,
      progress: { total: rows.length, answered, skipped, open: rows.length - answered - skipped }
    });
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }
}

// POST: nächste ein bis drei Fragen erzeugen.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) {
    return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht eingerichtet." }, { status: 503 });
  }
  const payload = await req.json().catch(() => ({}));
  const letterId = typeof payload.letterId === "string" ? payload.letterId : null;

  try {
    const [evidence, rows, profile] = await Promise.all([
      loadEvidence(user.id), loadInterview(user.id, letterId), loadProfile(user.id)
    ]);
    const adm = profileById(payload.profileId);
    const res = await nextInterviewQuestions({
      admissions: admissionsBlock(adm),
      evidence: dataBlock("ERFAHRUNGEN", evidenceBlock(evidence)),
      profile: dataBlock("PROFIL", `${profileBlock(profile)}\n\nBisherige Antworten:\n${interviewBlock(rows)}`),
      asked: askedBlock(rows),
      language: "de"
    });

    if (res.enough || !res.questions?.length) {
      return NextResponse.json({ questions: [], enough: true, reason: res.reason || "Es liegt genug Material vor." });
    }

    // Höchstens drei, und keine Wiederholung bereits gestellter Fragen.
    const known = new Set(rows.map((r) => r.question_key));
    const fresh = res.questions
      .filter((q) => q.key && !known.has(q.key))
      .slice(0, 3)
      .map((q) => ({
        user_id: user.id, letter_id: letterId,
        question_key: String(q.key).slice(0, 80),
        question: String(q.question).slice(0, 600),
        targets: q.targets ? String(q.targets).slice(0, 200) : null,
        state: "offen"
      }));
    if (fresh.length) {
      const { error } = await supabaseAdmin().from("motivation_interview").insert(fresh);
      if (error) return NextResponse.json({ error: "db_error", message: "Die Fragen konnten nicht gespeichert werden." }, { status: 500 });
    }
    const updated = await loadInterview(user.id, letterId).catch(() => rows);
    return NextResponse.json({ questions: fresh, enough: false, reason: res.reason || null, rows: updated });
  } catch (e) {
    const info = aiErrorInfo(e);
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

// PATCH: Antwort speichern, ändern oder Frage überspringen.
export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const key = typeof body?.questionKey === "string" ? body.questionKey : "";
  if (!key) return NextResponse.json({ error: "bad_request", message: "Keine Frage angegeben." }, { status: 400 });

  const skip = body.skip === true;
  const answer = typeof body.answer === "string" ? body.answer.slice(0, 6000) : null;
  const update = skip
    ? { state: "uebersprungen", updated_at: new Date().toISOString() }
    : { answer, state: (answer || "").trim() ? "beantwortet" : "offen", updated_at: new Date().toISOString() };

  const { error } = await supabaseAdmin()
    .from("motivation_interview").update(update)
    .eq("user_id", user.id).eq("question_key", key);
  if (error) return NextResponse.json({ error: "db_error", message: "Die Antwort konnte nicht gespeichert werden." }, { status: 500 });

  const rows = await loadInterview(user.id, typeof body.letterId === "string" ? body.letterId : null).catch(() => []);
  return NextResponse.json({ ok: true, rows, savedAt: new Date().toISOString() });
}

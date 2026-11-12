import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadExamples, loadLetter } from "@/lib/motivationContext";
import { openQuestions, QUESTION_GROUPS } from "@/lib/motivation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 4000;

// GET ?letter=<id> : vorhandene Antworten + noch offene Rückfragen.
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const letterId = new URL(req.url).searchParams.get("letter");
  try {
    const examples = await loadExamples(user.id, letterId);
    return NextResponse.json({ examples, open: openQuestions(examples), groups: QUESTION_GROUPS });
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }
}

// PUT: eine Antwort speichern/aktualisieren (idempotent je Frageschlüssel).
export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request", message: "Ungültige Eingabe." }, { status: 400 });
  }

  const questionKey = typeof body.questionKey === "string" ? body.questionKey.trim().slice(0, 80) : "";
  if (!questionKey) return NextResponse.json({ error: "bad_request", message: "Frage fehlt." }, { status: 400 });

  // Nur Fragen aus dem Katalog zulassen – schützt vor beliebigen Schlüsseln.
  const known = QUESTION_GROUPS.flatMap((g) => g.questions).find((q) => q.key === questionKey);
  const question = known?.question || (typeof body.question === "string" ? body.question.slice(0, 500) : "");
  if (!question) return NextResponse.json({ error: "bad_request", message: "Unbekannte Frage." }, { status: 400 });

  const letterId = typeof body.letterId === "string" && body.letterId ? body.letterId : null;
  if (letterId) {
    const letter = await loadLetter(user.id, letterId).catch(() => null);
    if (!letter) return NextResponse.json({ error: "not_found", message: "Das Schreiben gibt es nicht." }, { status: 404 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX) : null);
  const row = {
    user_id: user.id,
    letter_id: letterId,
    question_key: questionKey,
    question,
    situation: str(body.situation),
    contribution: str(body.contribution),
    result: str(body.result),
    link: str(body.link),
    is_planned: !!body.isPlanned,
    updated_at: new Date().toISOString()
  };

  // Vorhandene Antwort aktualisieren, sonst neu anlegen.
  // (letter_id ist nullable, daher getrennte Filterform für NULL.)
  let lookup = supabaseAdmin()
    .from("motivation_examples").select("id")
    .eq("user_id", user.id).eq("question_key", questionKey);
  lookup = letterId ? lookup.eq("letter_id", letterId) : lookup.is("letter_id", null);
  const { data: hit } = await lookup.maybeSingle();

  const { error } = hit
    ? await supabaseAdmin().from("motivation_examples").update(row).eq("id", hit.id).eq("user_id", user.id)
    : await supabaseAdmin().from("motivation_examples").insert(row);
  if (error) return NextResponse.json({ error: "db_error", message: "Die Antwort konnte nicht gespeichert werden." }, { status: 500 });

  const examples = await loadExamples(user.id, letterId).catch(() => []);
  return NextResponse.json({ ok: true, examples, open: openQuestions(examples), savedAt: new Date().toISOString() });
}

// DELETE ?id=<uuid>
export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "bad_request", message: "Keine Antwort angegeben." }, { status: 400 });
  const { error } = await supabaseAdmin().from("motivation_examples").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "db_error", message: "Die Antwort konnte nicht gelöscht werden." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

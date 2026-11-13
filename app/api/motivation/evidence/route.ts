import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadEvidence, evidenceToRow, loadSourceMaterial } from "@/lib/motivationContext";
import { aiConfigured, aiErrorInfo, extractEvidenceFromDocuments } from "@/lib/anthropic";
import { findContradictions, isStoryReady, missingFields, selectStories, type EvidenceItem } from "@/lib/evidence";
import { dataBlock } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: alle Erfahrungen des Nutzers samt Auswertung.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const items = await loadEvidence(user.id);
    return NextResponse.json({
      items,
      contradictions: findContradictions(items),
      storyReady: items.filter(isStoryReady).map((i) => i.id),
      gaps: items.map((i) => ({ id: i.id, title: i.title, missing: missingFields(i) })),
      selected: selectStories(items).map((i) => i.title)
    });
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }
}

// PUT: eine Erfahrung anlegen oder ändern.
export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !String(body.title || "").trim()) {
    return NextResponse.json({ error: "bad_request", message: "Ein Titel wird gebraucht." }, { status: 400 });
  }
  const row = evidenceToRow(user.id, body as EvidenceItem);
  const { error } = body.id
    ? await supabaseAdmin().from("motivation_evidence").update(row).eq("id", body.id).eq("user_id", user.id)
    : await supabaseAdmin().from("motivation_evidence").insert(row);
  if (error) return NextResponse.json({ error: "db_error", message: "Die Erfahrung konnte nicht gespeichert werden." }, { status: 500 });
  const items = await loadEvidence(user.id).catch(() => []);
  return NextResponse.json({ ok: true, items, contradictions: findContradictions(items) });
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "bad_request", message: "Keine Erfahrung angegeben." }, { status: 400 });
  const { error } = await supabaseAdmin().from("motivation_evidence").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "db_error", message: "Die Erfahrung konnte nicht gelöscht werden." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// POST: Erfahrungen aus den hinterlegten Unterlagen vorschlagen.
// Legt NICHTS automatisch an – der Nutzer übernimmt bewusst.
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) {
    return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht eingerichtet." }, { status: 503 });
  }
  try {
    const source = await loadSourceMaterial(user.id);
    if (!source.documentsText.trim() && !source.factsText.trim()) {
      return NextResponse.json({ error: "empty", message: "Es sind keine Unterlagen hinterlegt. Lade sie unter „Bewerbung → Meine Unterlagen“ hoch." }, { status: 400 });
    }
    const res = await extractEvidenceFromDocuments({
      documents: dataBlock("UNTERLAGEN", `${source.factsText}\n\n${source.documentsText}`),
      language: "de"
    });
    return NextResponse.json({ suggestions: res.items || [], note: res.note || null, sources: { factCount: source.factCount, documents: source.documents } });
  } catch (e) {
    const info = aiErrorInfo(e);
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

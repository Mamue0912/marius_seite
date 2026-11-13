import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadLetter, loadExamples, saveVersion } from "@/lib/motivationContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 60_000;
const STAGES = ["profil", "beispiele", "bezug", "gliederung", "entwurf", "ueberarbeitung", "export"];

// GET: ein Schreiben inkl. zugehöriger persönlicher Beispiele.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const letter = await loadLetter(user.id, id);
    if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const examples = await loadExamples(user.id, id);
    return NextResponse.json({ letter, examples });
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }
}

// PATCH: Autosave und Bearbeitung. Speichert vor einer Textänderung eine
// wiederherstellbare Version, damit nichts unwiederbringlich verloren geht.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let letter;
  try {
    letter = await loadLetter(user.id, id);
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }
  if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request", message: "Ungültige Eingabe." }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.body === "string") {
    if (body.body.length > MAX_BODY) {
      return NextResponse.json({ error: "too_large", message: "Der Text ist zu lang." }, { status: 413 });
    }
    // Alten Stand sichern, BEVOR er überschrieben wird.
    if (letter.body && letter.body !== body.body) {
      await saveVersion(user.id, letter.id, letter.body, typeof body.versionLabel === "string" ? body.versionLabel.slice(0, 120) : "Automatisch gesichert", "auto")
        .catch(() => { /* Historie ist Komfort, darf das Speichern nicht blockieren */ });
    }
    update.body = body.body;
  }
  if (typeof body.title === "string") update.title = body.title.trim().slice(0, 300) || null;
  if (typeof body.institution === "string" && body.institution.trim()) update.institution = body.institution.trim().slice(0, 300);
  if (typeof body.programme === "string" && body.programme.trim()) update.programme = body.programme.trim().slice(0, 300);
  if (typeof body.intake === "string") update.intake = body.intake.trim().slice(0, 100) || null;
  if (body.language === "de" || body.language === "en") update.language = body.language;
  if (body.preset === "custom" || body.preset === "whu_bachelor") update.preset = body.preset;
  if (["persoenlich", "klassisch", "analytisch"].includes(body.tone)) update.tone = body.tone;
  if (typeof body.stage === "string" && STAGES.includes(body.stage)) update.stage = body.stage;
  if (Array.isArray(body.outline)) {
    update.outline = body.outline.slice(0, 12).map((s: any) => ({
      id: String(s?.id || "").slice(0, 40) || Math.random().toString(36).slice(2, 10),
      heading: String(s?.heading || "").slice(0, 200),
      intent: String(s?.intent || "").slice(0, 600)
    }));
  }

  if (Object.keys(update).length === 1) {
    // Nichts zu tun. Das ist kein Fehler des Nutzers – der aktuelle Stand
    // wird einfach unverändert zurückgegeben.
    return NextResponse.json({ letter, savedAt: new Date().toISOString(), unchanged: true });
  }

  const { data, error } = await supabaseAdmin()
    .from("motivation_letters").update(update)
    .eq("id", letter.id).eq("user_id", user.id).select("*").single();
  if (error) return NextResponse.json({ error: "db_error", message: "Das Schreiben konnte nicht gespeichert werden." }, { status: 500 });
  return NextResponse.json({ letter: data, savedAt: new Date().toISOString() });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { error } = await supabaseAdmin().from("motivation_letters").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "db_error", message: "Das Schreiben konnte nicht gelöscht werden." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

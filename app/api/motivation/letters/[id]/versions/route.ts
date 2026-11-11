import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadLetter, saveVersion } from "@/lib/motivationContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: Versionsliste (ohne Volltext, damit die Liste schlank bleibt).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin()
    .from("motivation_versions").select("id,label,origin,created_at")
    .eq("user_id", user.id).eq("letter_id", id)
    .order("created_at", { ascending: false }).limit(30);
  if (error) return NextResponse.json({ error: "db_error", message: "Die Versionen konnten nicht geladen werden." }, { status: 500 });
  return NextResponse.json({ versions: data || [] });
}

// POST { versionId }: Version wiederherstellen.
// Der aktuelle Stand wird vorher gesichert – Wiederherstellen verliert nichts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const versionId = typeof body.versionId === "string" ? body.versionId : "";
  if (!versionId) return NextResponse.json({ error: "bad_request", message: "Keine Version angegeben." }, { status: 400 });

  let letter;
  try {
    letter = await loadLetter(user.id, id);
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }
  if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: version, error: vErr } = await supabaseAdmin()
    .from("motivation_versions").select("*")
    .eq("id", versionId).eq("user_id", user.id).eq("letter_id", id).maybeSingle();
  if (vErr) return NextResponse.json({ error: "db_error", message: "Die Version konnte nicht geladen werden." }, { status: 500 });
  if (!version) return NextResponse.json({ error: "not_found", message: "Diese Version gibt es nicht." }, { status: 404 });

  if (letter.body) {
    await saveVersion(user.id, letter.id, letter.body, "Stand vor dem Wiederherstellen", "auto").catch(() => {});
  }
  const { data, error } = await supabaseAdmin()
    .from("motivation_letters")
    .update({ body: version.body, updated_at: new Date().toISOString() })
    .eq("id", letter.id).eq("user_id", user.id).select("*").single();
  if (error) return NextResponse.json({ error: "db_error", message: "Die Version konnte nicht wiederhergestellt werden." }, { status: 500 });
  return NextResponse.json({ letter: data });
}

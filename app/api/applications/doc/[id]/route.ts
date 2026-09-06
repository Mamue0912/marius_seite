import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildDocx, safeFileName } from "@/lib/docxBuilder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dbFailure(message: string) {
  return NextResponse.json({ error: "db_error", message }, { status: 500 });
}

async function owned(userId: string, id: string) {
  return await supabaseAdmin().from("application_docs").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
}

// GET ?format=docx → DOCX-Download. Sonst JSON.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: document, error } = await owned(user.id, id);
  if (error) return dbFailure("Das Dokument konnte nicht geladen werden.");
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (new URL(req.url).searchParams.get("format") === "docx") {
    const { data: application, error: applicationError } = await supabaseAdmin().from("applications").select("company,position").eq("id", document.application_id).eq("user_id", user.id).maybeSingle();
    if (applicationError) return dbFailure("Die Dokumentdaten konnten nicht geladen werden.");
    const buffer = await buildDocx({ title: document.title || document.kind, body: document.body });
    const filename = safeFileName([application?.company, document.kind], "docx");
    return new NextResponse(buffer as any, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${filename}"`
      }
    });
  }
  return NextResponse.json({ doc: document });
}

// PATCH: Titel/Text im Cockpit bearbeiten.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: document, error: lookupError } = await owned(user.id, id);
  if (lookupError) return dbFailure("Das Dokument konnte nicht geprüft werden.");
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_request", message: "Ungültige Eingabe." }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.body === "string") {
    if (body.body.length > 100_000) return NextResponse.json({ error: "too_large", message: "Der Dokumenttext ist zu lang." }, { status: 413 });
    update.body = body.body;
  }
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title || title.length > 300) return NextResponse.json({ error: "bad_title", message: "Der Dokumenttitel ist ungültig." }, { status: 400 });
    update.title = title;
  }
  if (Object.keys(update).length === 1) return NextResponse.json({ error: "bad_request", message: "Keine Änderung angegeben." }, { status: 400 });
  const { error } = await supabaseAdmin().from("application_docs").update(update).eq("id", document.id).eq("user_id", user.id);
  if (error) return dbFailure("Das Dokument konnte nicht gespeichert werden.");
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: document, error: lookupError } = await owned(user.id, id);
  if (lookupError) return dbFailure("Das Dokument konnte nicht geprüft werden.");
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { error } = await supabaseAdmin().from("application_docs").delete().eq("id", document.id).eq("user_id", user.id);
  if (error) return dbFailure("Das Dokument konnte nicht gelöscht werden.");
  return NextResponse.json({ ok: true });
}
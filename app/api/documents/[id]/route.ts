import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { signedUrl, deleteDocument, uploadDocument } from "@/lib/storage";
import { extractText } from "@/lib/docExtract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const MAX_BYTES = 15 * 1024 * 1024;

async function owned(userId: string, id: string) {
  const { data } = await supabaseAdmin().from("app_documents").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = await signedUrl(doc.storage_path, 300);
  const { data: facts, error } = await supabaseAdmin().from("app_document_facts").select("*").eq("document_id", doc.id).eq("user_id", user.id).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "db_error", message: "Dokumentdetails konnten nicht vollständig geladen werden." }, { status: 500 });
  return NextResponse.json({ document: doc, previewUrl: url, facts: facts || [] });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim().slice(0, 300);
  if (typeof body.doc_type === "string") update.doc_type = body.doc_type.slice(0, 80);
  if (typeof body.allowed_for_applications === "boolean") update.allowed_for_applications = body.allowed_for_applications;
  const { error } = await supabaseAdmin().from("app_documents").update(update).eq("id", doc.id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "db_error", message: "Dokument konnte nicht gespeichert werden." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_request", message: "Ungültiger Upload." }, { status: 400 });
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no_file", message: "Keine Datei ausgewählt." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large", message: "Datei ist zu groß (max. 15 MB)." }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  let path: string;
  try {
    path = await uploadDocument(user.id, file.name || doc.name, buffer, mime);
  } catch {
    return NextResponse.json({ error: "upload_failed", message: "Die neue Datei konnte nicht gespeichert werden." }, { status: 502 });
  }

  let extracted: string | null = null;
  let status = "neu";
  try {
    const result = await extractText(buffer, mime, file.name || doc.name);
    if (result.text) {
      extracted = result.text;
      status = "verarbeitet";
    } else if (!result.isImage && !result.isPdf) {
      status = "fehler";
    }
  } catch {
    status = "fehler";
  }

  const admin = supabaseAdmin();
  const { data: updated, error: updateError } = await admin.from("app_documents").update({
    storage_path: path,
    mime,
    size_bytes: file.size,
    processing_status: status,
    extracted_text: extracted,
    updated_at: new Date().toISOString()
  }).eq("id", doc.id).eq("user_id", user.id).select("id").maybeSingle();

  if (updateError || !updated) {
    await deleteDocument(path).catch(() => undefined);
    return NextResponse.json({ error: "db_error", message: "Dokument konnte nicht ersetzt werden. Die bisherige Datei bleibt erhalten." }, { status: 500 });
  }

  const cleanup = await Promise.allSettled([
    deleteDocument(doc.storage_path),
    admin.from("app_document_facts").delete().eq("document_id", doc.id).eq("user_id", user.id)
  ]);
  const storageFailed = cleanup[0].status === "rejected";
  const factsFailed = cleanup[1].status === "rejected" || Boolean((cleanup[1] as PromiseFulfilledResult<any>).value?.error);
  const warning = storageFailed || factsFailed ? "Die Datei wurde ersetzt; alte Zusatzdaten werden beim nächsten Lauf bereinigt." : undefined;
  return NextResponse.json({ ok: true, warning });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { error } = await supabaseAdmin().from("app_documents").delete().eq("id", doc.id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "db_error", message: "Dokument konnte nicht gelöscht werden." }, { status: 500 });
  const storage = await deleteDocument(doc.storage_path).then(() => true).catch(() => false);
  return NextResponse.json({ ok: true, warning: storage ? undefined : "Der Dateieintrag wurde gelöscht; die Speicherdatei wird später bereinigt." });
}
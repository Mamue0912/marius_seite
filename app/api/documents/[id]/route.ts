import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { signedUrl, deleteDocument, uploadDocument } from "@/lib/storage";
import { extractText } from "@/lib/docExtract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

async function owned(userId: string, id: string) {
  const { data } = await supabaseAdmin().from("app_documents").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data;
}

// GET: Detail + kurzlebige Vorschau-URL + Fakten.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = await signedUrl(doc.storage_path, 300);
  const { data: facts } = await supabaseAdmin().from("app_document_facts").select("*").eq("document_id", doc.id).eq("user_id", user.id).order("created_at", { ascending: true });
  return NextResponse.json({ document: doc, previewUrl: url, facts: facts || [] });
}

// PATCH: umbenennen / Typ / Freigabe für Bewerbungen.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const update: any = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
  if (typeof body.doc_type === "string") update.doc_type = body.doc_type;
  if (typeof body.allowed_for_applications === "boolean") update.allowed_for_applications = body.allowed_for_applications;
  await supabaseAdmin().from("app_documents").update(update).eq("id", doc.id);
  return NextResponse.json({ ok: true });
}

// PUT (multipart): Datei ersetzen (alte löschen, neue speichern, neu extrahieren).
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no_file" }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const path = await uploadDocument(user.id, file.name || doc.name, buffer, mime);
  let extracted: string | null = null; let status = "neu";
  try { const res = await extractText(buffer, mime, file.name || doc.name); if (!res.isImage) { extracted = res.text; status = res.text ? "verarbeitet" : "fehler"; } } catch { status = "fehler"; }
  await deleteDocument(doc.storage_path);
  // Alte (nicht mehr belegbare) Fakten dieses Dokuments entfernen.
  await supabaseAdmin().from("app_document_facts").delete().eq("document_id", doc.id).eq("user_id", user.id);
  await supabaseAdmin().from("app_documents").update({ storage_path: path, mime, size_bytes: file.size, processing_status: status, extracted_text: extracted, updated_at: new Date().toISOString() }).eq("id", doc.id);
  return NextResponse.json({ ok: true });
}

// DELETE: Datei + Datensatz + Fakten entfernen.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await deleteDocument(doc.storage_path);
  await supabaseAdmin().from("app_documents").delete().eq("id", doc.id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

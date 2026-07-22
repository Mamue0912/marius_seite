import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { uploadDocument } from "@/lib/storage";
import { extractText, guessDocType } from "@/lib/docExtract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const MAX_BYTES = 15 * 1024 * 1024;

// GET: alle Unterlagen des Nutzers (mit Anzahl offener/bestätigter Fakten).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: docs } = await admin.from("app_documents").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  const { data: facts } = await admin.from("app_document_facts").select("document_id,status").eq("user_id", user.id);
  const counts: Record<string, { offen: number; bestaetigt: number }> = {};
  for (const f of facts || []) {
    const c = (counts[f.document_id] ||= { offen: 0, bestaetigt: 0 });
    if (f.status === "bestaetigt") c.bestaetigt++; else if (f.status === "offen") c.offen++;
  }
  return NextResponse.json({ documents: (docs || []).map((d) => ({ ...d, factCounts: counts[d.id] || { offen: 0, bestaetigt: 0 } })) });
}

// POST (multipart): Datei hochladen → speichern → Text extrahieren.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "bad_request", message: "Ungültiger Upload." }, { status: 400 }); }
  const file = form.get("file") as File | null;
  const docType = (form.get("doc_type") as string) || "";
  if (!file) return NextResponse.json({ error: "no_file", message: "Keine Datei ausgewählt." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large", message: "Datei ist zu groß (max. 15 MB)." }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const name = file.name || "Dokument";

  let path: string;
  try { path = await uploadDocument(user.id, name, buffer, mime); }
  catch (e) { return NextResponse.json({ error: "upload_failed", message: "Speichern fehlgeschlagen. Ist der Storage-Bucket 'documents' angelegt?" }, { status: 502 }); }

  // Textextraktion (Bilder werden später per Vision gelesen).
  let extracted: string | null = null;
  let status = "neu";
  try {
    const res = await extractText(buffer, mime, name);
    if (!res.isImage) { extracted = res.text; status = res.text ? "verarbeitet" : "fehler"; }
    else status = "neu"; // Bild → Fakten via Vision on demand
  } catch { status = "fehler"; }

  const { data: row, error } = await supabaseAdmin().from("app_documents").insert({
    user_id: user.id, name, doc_type: docType || guessDocType(name),
    storage_path: path, mime, size_bytes: file.size,
    processing_status: status, extracted_text: extracted, allowed_for_applications: true
  }).select("*").single();
  if (error) return NextResponse.json({ error: "db_error", message: "Konnte Dokument nicht speichern." }, { status: 500 });

  return NextResponse.json({ document: { ...row, factCounts: { offen: 0, bestaetigt: 0 } } });
}

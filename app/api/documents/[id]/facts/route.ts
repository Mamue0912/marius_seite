import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { downloadDocument } from "@/lib/storage";
import { imageBlock, isImageMime, isPdf, pdfBlock } from "@/lib/docExtract";
import { extractDocumentFacts, aiConfigured, aiErrorInfo, Block } from "@/lib/anthropic";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const FACT_CATEGORIES = new Set(["schule", "abschluss", "note", "praktikum", "erfahrung", "sprache", "projekt", "zertifikat", "sport", "faehigkeit", "sonstiges"]);

function dbFailure(message: string) {
  return NextResponse.json({ error: "db_error", message }, { status: 500 });
}

async function owned(userId: string, id: string) {
  return await supabaseAdmin().from("app_documents").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
}

// POST: Aktionen rund um Fakten.
//  action = "extract"  → KI erkennt Fakten (zur Bestätigung, Status offen)
//  action = "confirm" | "reject"  { factId }
//  action = "add"      { category, value }  (manuell, direkt bestätigt)
//  action = "update"   { factId, value }
//  action = "delete"   { factId }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: document, error: documentError } = await owned(user.id, id);
  if (documentError) return dbFailure("Die Unterlage konnte nicht geladen werden.");
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const admin = supabaseAdmin();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_request", message: "Ungültige Eingabe." }, { status: 400 });
  const action = body.action;

  if (["confirm", "reject", "delete", "update"].includes(action)) {
    const factId = typeof body.factId === "string" ? body.factId : "";
    if (!factId) return NextResponse.json({ error: "bad_request", message: "Keine Angabe ausgewählt." }, { status: 400 });
    if (action === "delete") {
      const { data, error } = await admin.from("app_document_facts").delete().eq("id", factId).eq("document_id", document.id).eq("user_id", user.id).select("id").maybeSingle();
      if (error) return dbFailure("Die Angabe konnte nicht gelöscht werden.");
      if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    const update = action === "update"
      ? { value: typeof body.value === "string" ? body.value.trim() : "" }
      : { status: action === "confirm" ? "bestaetigt" : "abgelehnt" };
    if (action === "update" && (!update.value || update.value.length > 5_000)) {
      return NextResponse.json({ error: "bad_request", message: "Die Angabe ist leer oder zu lang." }, { status: 400 });
    }
    const { data, error } = await admin.from("app_document_facts").update(update).eq("id", factId).eq("document_id", document.id).eq("user_id", user.id).select("id").maybeSingle();
    if (error) return dbFailure("Die Angabe konnte nicht gespeichert werden.");
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (action === "add") {
    const value = typeof body.value === "string" ? body.value.trim() : "";
    const category = FACT_CATEGORIES.has(body.category) ? body.category : "sonstiges";
    if (!value || value.length > 5_000) return NextResponse.json({ error: "bad_request", message: "Die Angabe ist leer oder zu lang." }, { status: 400 });
    const { data, error } = await admin.from("app_document_facts").insert({
      user_id: user.id,
      document_id: document.id,
      category,
      value,
      status: "bestaetigt",
      source: "manuell"
    }).select("*").single();
    if (error || !data) return dbFailure("Die Angabe konnte nicht hinzugefügt werden.");
    return NextResponse.json({ fact: data });
  }

  if (action !== "extract") return NextResponse.json({ error: "bad_request", message: "Unbekannte Aktion." }, { status: 400 });
  if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });
  const started = Date.now();
  try {
    let content: string | Block[];
    if (document.extracted_text) {
      content = document.extracted_text.slice(0, 12_000);
    } else {
      // Kein Text vorhanden → Datei laden und als Bild bzw. PDF-Dokument an die KI.
      const download = await downloadDocument(document.storage_path);
      if (!download) return NextResponse.json({ error: "no_content", message: "Dateiinhalt konnte nicht gelesen werden." }, { status: 502 });
      if (isImageMime(document.mime) || isImageMime(download.mime)) content = [imageBlock(download.buffer, document.mime || download.mime)];
      else if (isPdf(document.mime, document.name)) content = [pdfBlock(download.buffer)];
      else return NextResponse.json({ error: "no_text", message: "Aus dieser Datei konnte kein Text gelesen werden." }, { status: 422 });
    }

    const { facts } = await extractDocumentFacts({ content });
    const { data: previousFacts, error: previousError } = await admin.from("app_document_facts").select("id").eq("document_id", document.id).eq("user_id", user.id).eq("source", "ki").eq("status", "offen");
    if (previousError) return dbFailure("Vorhandene Angaben konnten nicht geprüft werden.");

    let insertedIds: string[] = [];
    if (facts.length) {
      const rows = facts.map((fact) => ({ user_id: user.id, document_id: document.id, category: fact.category, value: fact.value, status: "offen", source: "ki" }));
      const { data: inserted, error: insertError } = await admin.from("app_document_facts").insert(rows).select("id");
      if (insertError) return dbFailure("Erkannte Angaben konnten nicht gespeichert werden.");
      insertedIds = (inserted || []).map((fact) => fact.id);
    }

    const previousIds = (previousFacts || []).map((fact) => fact.id);
    if (previousIds.length) {
      const { error: deleteError } = await admin.from("app_document_facts").delete().eq("user_id", user.id).eq("document_id", document.id).in("id", previousIds);
      if (deleteError) {
        if (insertedIds.length) await admin.from("app_document_facts").delete().eq("user_id", user.id).in("id", insertedIds);
        return dbFailure("Vorherige offene Angaben konnten nicht ersetzt werden.");
      }
    }
    const { error: statusError } = await admin.from("app_documents").update({ processing_status: "verarbeitet" }).eq("id", document.id).eq("user_id", user.id);
    if (statusError) return dbFailure("Der Verarbeitungsstatus konnte nicht gespeichert werden.");

    await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: "fakten:" + document.name });
    const { data: all, error: allError } = await admin.from("app_document_facts").select("*").eq("document_id", document.id).eq("user_id", user.id).order("created_at", { ascending: true });
    if (allError) return dbFailure("Die erkannten Angaben konnten nicht geladen werden.");
    return NextResponse.json({ facts: all || [] });
  } catch (caught) {
    const info = aiErrorInfo(caught);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: "fakten:" + document.name });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}
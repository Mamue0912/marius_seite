import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { downloadDocument } from "@/lib/storage";
import { imageBlock, isImageMime } from "@/lib/docExtract";
import { extractDocumentFacts, aiConfigured, aiErrorInfo, Block } from "@/lib/anthropic";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

async function owned(userId: string, id: string) {
  const { data } = await supabaseAdmin().from("app_documents").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data;
}

// POST: Aktionen rund um Fakten.
//  action = "extract"  → KI erkennt Fakten (zur Bestätigung, Status offen)
//  action = "confirm" | "reject"  { factId }
//  action = "add"      { category, value }  (manuell, direkt bestätigt)
//  action = "update"   { factId, value }
//  action = "delete"   { factId }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const admin = supabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "confirm" || action === "reject") {
    await admin.from("app_document_facts").update({ status: action === "confirm" ? "bestaetigt" : "abgelehnt" }).eq("id", body.factId).eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  }
  if (action === "delete") {
    await admin.from("app_document_facts").delete().eq("id", body.factId).eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  }
  if (action === "update") {
    await admin.from("app_document_facts").update({ value: String(body.value || "").trim() }).eq("id", body.factId).eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  }
  if (action === "add") {
    if (!body.value?.trim()) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const { data } = await admin.from("app_document_facts").insert({
      user_id: user.id, document_id: doc.id, category: body.category || "sonstiges",
      value: String(body.value).trim(), status: "bestaetigt", source: "manuell"
    }).select("*").single();
    return NextResponse.json({ fact: data });
  }

  // action === "extract"
  if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });
  const started = Date.now();
  try {
    let content: string | Block[];
    if (doc.extracted_text) {
      content = doc.extracted_text.slice(0, 12000);
    } else if (isImageMime(doc.mime) || doc.processing_status === "neu") {
      const dl = await downloadDocument(doc.storage_path);
      if (!dl) return NextResponse.json({ error: "no_content", message: "Dateiinhalt konnte nicht gelesen werden." }, { status: 502 });
      if (isImageMime(dl.mime) || isImageMime(doc.mime)) content = [imageBlock(dl.buffer, doc.mime || dl.mime)];
      else return NextResponse.json({ error: "no_text", message: "Aus dieser Datei konnte kein Text gelesen werden." }, { status: 422 });
    } else {
      return NextResponse.json({ error: "no_text", message: "Kein lesbarer Inhalt vorhanden." }, { status: 422 });
    }

    const { facts } = await extractDocumentFacts({ content });
    // Vorherige KI-Fakten (noch offen) ersetzen; bestätigte/abgelehnte bleiben.
    await admin.from("app_document_facts").delete().eq("document_id", doc.id).eq("user_id", user.id).eq("source", "ki").eq("status", "offen");
    if (facts.length) {
      await admin.from("app_document_facts").insert(facts.map((f) => ({ user_id: user.id, document_id: doc.id, category: f.category, value: f.value, status: "offen", source: "ki" })));
    }
    await admin.from("app_documents").update({ processing_status: "verarbeitet" }).eq("id", doc.id);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: "fakten:" + doc.name });
    const { data: all } = await admin.from("app_document_facts").select("*").eq("document_id", doc.id).eq("user_id", user.id).order("created_at", { ascending: true });
    return NextResponse.json({ facts: all || [] });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: "fakten:" + doc.name });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

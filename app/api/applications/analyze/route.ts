import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { analyzeJobPosting, aiConfigured, aiErrorInfo, Block } from "@/lib/anthropic";
import { confirmedFactsText } from "@/lib/applicationContext";
import { findDuplicateApplication } from "@/lib/appDuplicate";
import { imageBlock, isImageMime } from "@/lib/docExtract";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";
import { fetchPublicResource, readTextLimited } from "@/lib/safeRemote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

async function fetchJobPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchPublicResource(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; CockpitBewerbung/1.0)", accept: "text/html,application/xhtml+xml" }
    });
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok || (contentType && !contentType.includes("html") && !contentType.includes("xml"))) {
      await response.body?.cancel();
      return null;
    }
    const html = await readTextLimited(response, 2 * 1024 * 1024);
    if (!html) return null;
    const text = htmlToText(html);
    return text.length > 200 ? text.slice(0, 14000) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });

  const admin = supabaseAdmin();
  const ctype = req.headers.get("content-type") || "";
  let applicationId: string | undefined;
  let mode = "text";
  let content: string | Block[] | null = null;
  let jobUrl: string | null = null;
  let jobText: string | null = null;

  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      applicationId = (form.get("applicationId") as string) || undefined;
      mode = (form.get("mode") as string) || "pdf";
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "no_file", message: "Keine Datei ausgewählt." }, { status: 400 });
      if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "too_large", message: "Datei ist zu groß (max. 15 MB)." }, { status: 413 });
      const buffer = Buffer.from(await file.arrayBuffer());
      const mime = file.type || "application/octet-stream";
      if (isImageMime(mime) || /\.(png|jpe?g|webp|gif)$/i.test(file.name || "")) {
        content = [imageBlock(buffer, mime)];
        mode = "screenshot";
      } else {
        const { extractText, isPdf, pdfBlock } = await import("@/lib/docExtract");
        const res = await extractText(buffer, mime, file.name || "stelle.pdf");
        if (res.text) { content = res.text.slice(0, 14000); jobText = content; mode = "pdf"; }
        else if (isPdf(mime, file.name || "")) { content = [pdfBlock(buffer)]; mode = "pdf"; } // gescanntes PDF
        else return NextResponse.json({ error: "no_text", message: "Aus dieser Datei konnte kein Text gelesen werden." }, { status: 422 });
      }
    } else {
      const body = await req.json().catch(() => ({}));
      applicationId = body.applicationId;
      mode = body.mode || "text";
      if (mode === "url") {
        jobUrl = String(body.url || "").trim();
        if (!/^https?:\/\//i.test(jobUrl)) return NextResponse.json({ error: "bad_url", message: "Bitte einen gültigen Link (http/https) einfügen." }, { status: 400 });
        const text = await fetchJobPage(jobUrl);
        if (!text) return NextResponse.json({ error: "fetch_failed", message: "Die Stellenanzeige konnte nicht automatisch geladen werden. Bitte Text einfügen, PDF/Screenshot hochladen oder eine E-Mail übernehmen." }, { status: 422 });
        content = text; jobText = text;
      } else if (mode === "text") {
        jobText = String(body.text || "").trim();
        if (jobText.length < 40) return NextResponse.json({ error: "too_short", message: "Bitte mehr Text der Stellenanzeige einfügen." }, { status: 400 });
        content = jobText.slice(0, 14000);
      } else if (mode === "email") {
        const { data: msg } = await admin.from("messages").select("subject,from_name,from_address,preview").eq("id", body.messageId).eq("user_id", user.id).maybeSingle();
        if (!msg) return NextResponse.json({ error: "not_found", message: "E-Mail nicht gefunden." }, { status: 404 });
        jobText = `Betreff: ${msg.subject || ""}\nVon: ${msg.from_name || ""} <${msg.from_address || ""}>\n\n${msg.preview || ""}`;
        content = jobText;
      }
    }
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Eingabe konnte nicht verarbeitet werden." }, { status: 400 });
  }
  if (!content) return NextResponse.json({ error: "bad_request", message: "Kein Inhalt zum Analysieren." }, { status: 400 });

  const started = Date.now();
  try {
    const facts = await confirmedFactsText(user.id);
    const analysis = await analyzeJobPosting({ content, confirmedFactsText: facts });

    const row = {
      user_id: user.id,
      company: analysis.company, position: analysis.position, job_type: analysis.job_type,
      job_url: jobUrl, job_source: mode, job_text: jobText,
      analysis, deadline: /^\d{4}-\d{2}-\d{2}$/.test(analysis.deadline || "") ? analysis.deadline : null,
      contact: analysis.contact, status: "analyse_offen",
      updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString()
    };

    let appId = applicationId;
    if (appId) {
      const { data: exists, error: lookupError } = await admin.from("applications").select("id,status").eq("id", appId).eq("user_id", user.id).maybeSingle();
      if (lookupError) return NextResponse.json({ error: "db_error", message: lookupError.message }, { status: 500 });
      if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const keepStatus = ["interessant", "analyse_offen"].includes(exists.status) ? "analyse_offen" : exists.status;
      const { error: updateError } = await admin.from("applications").update({ ...row, status: keepStatus }).eq("id", appId).eq("user_id", user.id);
      if (updateError) return NextResponse.json({ error: "db_error", message: updateError.message }, { status: 500 });
    } else {
      const { data: created, error } = await admin.from("applications").insert(row).select("id").single();
      if (error) return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
      appId = created.id;
    }

    // Dublette? Nur bei neu angelegten Bewerbungen prüfen (nicht beim Aktualisieren).
    let duplicate = null;
    if (!applicationId) {
      duplicate = await findDuplicateApplication(user.id, { id: appId!, company: analysis.company, position: analysis.position, job_url: jobUrl });
    }

    await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: "stelle:" + (analysis.position || "") });
    return NextResponse.json({ applicationId: appId, analysis, duplicate });
  } catch (e) {
    const info = aiErrorInfo(e);
    console.error("analyze failed:", info.category, (e as Error).message);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: "stelle" });
    const msg = info.category === "api_error" ? "Die Stellenanzeige konnte nicht verarbeitet werden." : info.message;
    return NextResponse.json({ error: info.category, message: msg }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

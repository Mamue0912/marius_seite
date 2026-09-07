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

// Ergebnis mit Grund: Eine Sammelmeldung ("konnte nicht geladen werden") sagt
// dem Nutzer nicht, was er tun soll. Jeder Grund hat einen eigenen Hinweis.
type JobPageResult =
  | { ok: true; text: string }
  | { ok: false; reason: "blocked" | "notfound" | "notHtml" | "tooShort" | "unreachable" };

const JOB_PAGE_HINT: Record<string, string> = {
  blocked: "Diese Seite blockiert automatische Zugriffe (z. B. StepStone, LinkedIn, Indeed). Bitte den Anzeigentext kopieren und unter „Text einfügen“ verwenden.",
  notfound: "Unter diesem Link war nichts zu finden. Bitte den Link prüfen – Stellenanzeigen werden oft nach kurzer Zeit entfernt.",
  notHtml: "Der Link zeigt keine Webseite, sondern eine Datei (z. B. ein PDF). Bitte die Datei unter „Datei hochladen“ verwenden.",
  tooShort: "Diese Seite lädt ihre Inhalte erst im Browser nach, deshalb ist der Text hier leer. Bitte den Anzeigentext kopieren und unter „Text einfügen“ verwenden.",
  unreachable: "Die Stellenanzeige konnte nicht automatisch geladen werden. Bitte Text einfügen, PDF/Screenshot hochladen oder eine E-Mail übernehmen."
};

async function fetchJobPage(url: string): Promise<JobPageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchPublicResource(url, {
      signal: controller.signal,
      headers: {
        // Eine öffentliche Seite, die der Nutzer selbst eingefügt hat. Viele
        // Stellenbörsen liefern an offensichtliche Automaten gar nichts aus,
        // deshalb ein gebräuchlicher Browser-Kopf statt eines Bot-Kennzeichens.
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "de-DE,de;q=0.9,en;q=0.8"
      }
    });
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      if (status === 401 || status === 403 || status === 429) return { ok: false, reason: "blocked" };
      if (status === 404 || status === 410) return { ok: false, reason: "notfound" };
      return { ok: false, reason: "unreachable" };
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("html") && !contentType.includes("xml")) {
      await response.body?.cancel();
      return { ok: false, reason: "notHtml" };
    }
    const html = await readTextLimited(response, 2 * 1024 * 1024);
    if (!html) return { ok: false, reason: "unreachable" };
    const text = htmlToText(html);
    if (text.length <= 200) return { ok: false, reason: "tooShort" };
    return { ok: true, text: text.slice(0, 14000) };
  } catch {
    return { ok: false, reason: "unreachable" };
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
        // Kopierte Links kommen häufig ohne Schema ("www.stepstone.de/…") oder
        // mit umschließenden Zeichen aus E-Mails. Beides wird ergänzt bzw.
        // entfernt, statt die Eingabe abzulehnen.
        jobUrl = jobUrl.replace(/^[<("'\s]+|[>)"'\s.,]+$/g, "");
        if (jobUrl && !/^https?:\/\//i.test(jobUrl)) jobUrl = "https://" + jobUrl;
        if (!/^https?:\/\/[^\s.]+\.[^\s]+/i.test(jobUrl)) {
          return NextResponse.json({ error: "bad_url", message: "Das sieht nicht nach einem Link aus. Bitte die vollständige Adresse der Stellenanzeige einfügen." }, { status: 400 });
        }
        const page = await fetchJobPage(jobUrl);
        if (!page.ok) return NextResponse.json({ error: "fetch_failed", message: JOB_PAGE_HINT[page.reason] }, { status: 422 });
        const text = page.text;
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

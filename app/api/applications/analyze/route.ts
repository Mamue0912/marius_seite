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
import { extractJobPostingPage, normalizeJobUrl, type JobPageExtraction } from "@/lib/jobPostingExtract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

type JobPageResult =
  | { ok: true; extraction: JobPageExtraction }
  | { ok: false; reason: "blocked" | "notfound" | "notHtml" | "tooShort" | "unreachable" | "consent" | "notJob"; partial?: JobPageExtraction };

const JOB_PAGE_HINT: Record<string, string> = {
  blocked: "Die Website blockiert automatische Zugriffe. Öffne die Anzeige im Browser und füge den Anzeigentext unter „Text einfügen“ ein.",
  notfound: "Unter diesem Link ist keine Anzeige mehr erreichbar. Prüfe den Link oder füge den gespeicherten Anzeigentext ein.",
  notHtml: "Der Link führt zu einer Datei statt zu einer Webseite. Lade die Datei bitte unter „PDF/Screenshot“ hoch.",
  tooShort: "Die Anzeige lädt ihren Inhalt ausschließlich im Browser nach. Kopiere den sichtbaren Anzeigentext und nutze „Text einfügen“.",
  consent: "Die Website liefert nur eine Cookie- oder Zustimmungsseite. Öffne sie im Browser, bestätige dort die Auswahl und füge anschließend den Anzeigentext ein.",
  notJob: "Auf der erreichbaren Seite wurde keine Stellenanzeige erkannt. Prüfe, ob der Link direkt zur Anzeige führt, oder füge den Anzeigentext ein.",
  unreachable: "Die Stellenanzeige ist nicht öffentlich erreichbar oder hat zu lange geantwortet. Du kannst stattdessen Text, PDF, Screenshot oder E-Mail übernehmen."
};

async function fetchJobPage(url: string): Promise<JobPageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetchPublicResource(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "de-DE,de;q=0.9,en;q=0.8",
        "cache-control": "no-cache"
      }
    }, 6);
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      if (status === 401 || status === 403 || status === 429 || status === 451) return { ok:false, reason:"blocked" };
      if (status === 404 || status === 410) return { ok:false, reason:"notfound" };
      return { ok:false, reason:"unreachable" };
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("html") && !contentType.includes("xml")) {
      await response.body?.cancel();
      return { ok:false, reason:"notHtml" };
    }
    const html = await readTextLimited(response, 3 * 1024 * 1024);
    if (!html) return { ok:false, reason:"unreachable" };
    const finalUrl = response.headers.get("x-cockpit-final-url") || url;
    const extraction = extractJobPostingPage(html, finalUrl);
    if (extraction.obstacle === "challenge") return { ok:false, reason:"blocked", partial:extraction };
    if (extraction.obstacle === "consent") return { ok:false, reason:"consent", partial:extraction };
    if (!extraction.isJobPosting) {
      return { ok:false, reason:extraction.obstacle === "dynamic" ? "tooShort" : "notJob", partial:extraction };
    }
    return { ok:true, extraction };
  } catch {
    return { ok:false, reason:"unreachable" };
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
  let jobExtraction: JobPageExtraction | null = null;

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
        try {
          jobUrl = normalizeJobUrl(String(body.url || ""));
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          const message = code === "url_too_long"
            ? "Der Link ist ungewöhnlich lang. Bitte öffne die Anzeige und kopiere die bereinigte Adresse aus der Browserzeile."
            : "Das sieht nicht nach einer gültigen öffentlichen Webadresse aus. Bitte den vollständigen Link zur Stellenanzeige einfügen.";
          return NextResponse.json({ error:"bad_url", message }, { status:400 });
        }
        const page = await fetchJobPage(jobUrl);
        if (!page.ok) {
          return NextResponse.json({
            error:"fetch_failed", reason:page.reason, message:JOB_PAGE_HINT[page.reason],
            normalizedUrl:jobUrl, partial:page.partial?.fields || null,
            fallbackText:page.partial?.text?.slice(0, 14000) || ""
          }, { status:422 });
        }
        jobExtraction = page.extraction;
        jobUrl = page.extraction.canonicalUrl;
        jobText = page.extraction.analysisText;
        content = jobText;

        if (!applicationId) {
          const { data: existingLinks } = await admin.from("applications")
            .select("id,company,position,job_url").eq("user_id",user.id).not("job_url","is",null).limit(500);
          const existing = (existingLinks || []).find((item) => {
            try { return normalizeJobUrl(item.job_url) === jobUrl; } catch { return false; }
          });
          if (existing) {
            return NextResponse.json({
              applicationId:existing.id, alreadyAnalyzed:true,
              duplicate:{ id:existing.id, company:existing.company, position:existing.position },
              extraction:page.extraction.fields
            });
          }
        }
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
    return NextResponse.json({ applicationId: appId, analysis, duplicate, extraction: jobExtraction?.fields || null });
  } catch (e) {
    const info = aiErrorInfo(e);
    console.error("analyze failed:", info.category, (e as Error).message);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: "stelle" });
    const msg = info.category === "api_error" ? "Die Stellenanzeige konnte nicht verarbeitet werden." : info.message;
    return NextResponse.json({ error: info.category, message: msg, normalizedUrl: jobUrl, partial: jobExtraction?.fields || null, fallbackText: jobExtraction?.text?.slice(0, 14000) || "" }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

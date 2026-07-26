import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { analyzeCompanyWebsite, aiConfigured, aiErrorInfo } from "@/lib/anthropic";
import { confirmedFactsText } from "@/lib/applicationContext";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

async function fetchHtml(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; CockpitBewerbung/1.0)", accept: "text/html,application/xhtml+xml" }
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("xml") && ct !== "") return null;
    return await r.text();
  } catch { return null; }
}

// Relevante Unterseiten anhand von Link-Text/URL erkennen (Über uns, Karriere …).
const SECTION_RE = /(ueber-?uns|über-?uns|about|unternehmen|company|karriere|career|jobs?|stellen|leistung|service|produkt|team|werte|values|mission|standort|location|kontakt|contact|projekt|portfolio|branchen|expertise)/i;

function extractSubpages(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const found = new Map<string, number>(); // url -> score
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(html)) !== null && count < 400) {
    count++;
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, " ").trim();
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs: URL;
    try { abs = new URL(href, baseUrl); } catch { continue; }
    if (abs.origin !== base.origin) continue; // nur gleiche Domain
    const key = abs.origin + abs.pathname.replace(/\/$/, "");
    if (key === base.origin + base.pathname.replace(/\/$/, "")) continue; // Startseite selbst
    const hay = `${abs.pathname} ${text}`;
    if (!SECTION_RE.test(hay)) continue;
    // Karriere/Über uns höher gewichten
    const score = /(karriere|career|jobs?|stellen)/i.test(hay) ? 3 : /(ueber|über|about|unternehmen|company|werte|values|mission)/i.test(hay) ? 2 : 1;
    found.set(key, Math.max(found.get(key) || 0, score));
  }
  return Array.from(found.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u]) => u);
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  let url = String(body.url || "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url; // ohne Schema erlauben
  if (!/^https?:\/\/[^\s.]+\.[^\s]+/i.test(url)) return NextResponse.json({ error: "bad_url", message: "Bitte einen gültigen Website-Link einfügen." }, { status: 400 });

  // Startseite laden.
  const homeHtml = await fetchHtml(url, 12000);
  if (!homeHtml) return NextResponse.json({ error: "fetch_failed", message: "Die Website konnte nicht geladen werden. Bitte den Link prüfen." }, { status: 422 });

  // Relevante Unterseiten parallel laden (mit Zeitbudget).
  const subUrls = extractSubpages(homeHtml, url);
  const subHtmls = await Promise.all(subUrls.map((u) => fetchHtml(u, 9000)));

  const parts: string[] = [];
  parts.push(`# Startseite (${url})\n${htmlToText(homeHtml).slice(0, 6000)}`);
  subUrls.forEach((u, i) => { const h = subHtmls[i]; if (h) parts.push(`# Unterseite (${u})\n${htmlToText(h).slice(0, 4000)}`); });
  const combined = parts.join("\n\n").slice(0, 18000);
  if (combined.replace(/\s+/g, "").length < 200) {
    return NextResponse.json({ error: "no_text", message: "Von dieser Website konnte kaum Text gelesen werden (evtl. reine JavaScript-Seite). Bitte Text der Seite manuell einfügen." }, { status: 422 });
  }

  const started = Date.now();
  try {
    const facts = await confirmedFactsText(user.id);
    const analysis = await analyzeCompanyWebsite({ content: combined, siteUrl: url, confirmedFactsText: facts });

    const admin = supabaseAdmin();
    const row = {
      user_id: user.id,
      company: analysis.company, position: analysis.position, job_type: analysis.job_type,
      job_url: url, job_source: "website", job_text: combined.slice(0, 14000),
      analysis, deadline: null, contact: analysis.contact, status: "analyse_offen",
      updated_at: new Date().toISOString(), last_activity_at: new Date().toISOString()
    };
    let appId = body.applicationId as string | undefined;
    if (appId) {
      const { data: exists } = await admin.from("applications").select("id,status").eq("id", appId).eq("user_id", user.id).maybeSingle();
      if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404 });
      await admin.from("applications").update(row).eq("id", appId);
    } else {
      const { data: created, error } = await admin.from("applications").insert(row).select("id").single();
      if (error) return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
      appId = created.id;
    }

    await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: "website:" + (analysis.company || "") });
    return NextResponse.json({ applicationId: appId, analysis, pages: [url, ...subUrls] });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: "website" });
    const msg = info.category === "api_error" ? "Die Website konnte nicht analysiert werden." : info.message;
    return NextResponse.json({ error: info.category, message: msg }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

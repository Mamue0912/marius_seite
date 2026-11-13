import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadLetter, loadProfile, loadExamples, plannedTerms, loadSourceMaterial } from "@/lib/motivationContext";
import { checkRequirements, qualityFindings, countWords, countChars, paragraphs, missingProfileFields } from "@/lib/motivation";
import { buildMotivationPdf } from "@/lib/motivationPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST { letterId, body? }
//
// Prüft OHNE KI: verbindliche Vorgaben, Zähler, echte PDF-Seitenzahl und
// eigene Qualitätshinweise. Zeigt bewusst KEINE Zulassungswahrscheinlichkeit
// und keine vermeintlich offizielle Bewertung der Hochschule.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => ({}));
  const letterId = typeof payload.letterId === "string" ? payload.letterId : "";
  if (!letterId) return NextResponse.json({ error: "bad_request", message: "Kein Schreiben angegeben." }, { status: 400 });

  let letter, profile, examples, source;
  try {
    letter = await loadLetter(user.id, letterId);
    if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });
    profile = await loadProfile(user.id);
    examples = await loadExamples(user.id, letterId);
    source = await loadSourceMaterial(user.id);
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }

  // Ungespeicherten Text aus der Oberfläche bevorzugen, damit die Prüfung
  // den sichtbaren Stand bewertet.
  const body = typeof payload.body === "string" && payload.body.length <= 60_000 ? payload.body : letter.body;

  // Seitenzahl aus dem tatsächlichen Satz. Scheitert das, bleibt die
  // Prüfung trotzdem nutzbar (Seitenregel dann als "manuell").
  let pages: number | null = null;
  let fits: boolean | null = null;
  if (body.trim()) {
    try {
      const pdf = await buildMotivationPdf({ body, maxPages: 2 });
      pages = pdf.pages;
      fits = pdf.fits;
    } catch {
      pages = null;
    }
  }

  const requirements = checkRequirements({
    body, profile, language: letter.language === "en" ? "en" : "de", renderedPages: pages
  });
  // Unterlagen zählen als Belege: wer Lebenslauf/Zeugnisse hinterlegt hat,
  // soll nicht fälschlich "zu wenig Belege" gemeldet bekommen.
  const quality = qualityFindings({
    body, examples, plannedTerms: plannedTerms(profile, examples),
    evidenceCount: source.factCount + source.documents.length
  });

  const result = {
    counts: { words: countWords(body), chars: countChars(body), paragraphs: paragraphs(body).length },
    pages, fits,
    requirements,
    quality,
    missingProfile: missingProfileFields(profile),
    sources: { factCount: source.factCount, documents: source.documents },
    checkedAt: new Date().toISOString()
  };

  // Letztes Ergebnis für die Anzeige merken (nicht prüfungsrelevant).
  await supabaseAdmin().from("motivation_letters")
    .update({ last_check: result }).eq("id", letter.id).eq("user_id", user.id);

  return NextResponse.json(result);
}

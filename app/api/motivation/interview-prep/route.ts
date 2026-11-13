import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { aiConfigured, aiErrorInfo, interviewReadiness } from "@/lib/anthropic";
import { loadLetter, loadEvidence } from "@/lib/motivationContext";
import { evidenceBlock } from "@/lib/evidence";
import { profileById } from "@/lib/admissions";
import { admissionsBlock, dataBlock } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { letterId, body? }
// Erzeugt Rückfragen, die ein Prüfer auf Grundlage des Schreibens stellen
// würde, und benennt Aussagen, die im Gespräch dünn werden könnten.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) {
    return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht eingerichtet." }, { status: 503 });
  }
  const payload = await req.json().catch(() => ({}));
  const letterId = typeof payload.letterId === "string" ? payload.letterId : "";
  if (!letterId) return NextResponse.json({ error: "bad_request", message: "Kein Schreiben angegeben." }, { status: 400 });

  try {
    const letter = await loadLetter(user.id, letterId);
    if (!letter) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const body = typeof payload.body === "string" && payload.body.length <= 60_000 ? payload.body : letter.body;
    if (!body.trim()) return NextResponse.json({ error: "empty", message: "Es gibt noch keinen Text." }, { status: 400 });

    const evidence = await loadEvidence(user.id);
    const adm = profileById((letter as any).profile_id);
    const res = await interviewReadiness({
      admissions: admissionsBlock(adm),
      evidence: dataBlock("ERFAHRUNGEN", evidenceBlock(evidence)),
      body,
      language: letter.language === "en" ? "en" : "de"
    });
    return NextResponse.json({
      probes: res.probes || [], weakSpots: res.weakSpots || [], verdict: res.verdict || null
    });
  } catch (e) {
    const info = aiErrorInfo(e);
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

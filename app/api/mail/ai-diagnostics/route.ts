import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { recentAiEvents } from "@/lib/aiDiagnostics";
import { aiConfigured, lastServedModel, probeModels, aiErrorInfo } from "@/lib/anthropic";
import { env } from "@/lib/env";
import { modelChain, MODEL_CATALOG } from "@/lib/aiModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Owner-eigene KI-Diagnose: letzte Anfragen (Zeit, Erfolg, Dauer, Modell,
// Fehlerkategorie). KEINE Schlüssel, KEINE vollständigen Mailinhalte.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const events = await recentAiEvents(user.id, 20);
  return NextResponse.json({
    configured: aiConfigured(),
    model: aiConfigured() ? env.anthropicModel() : null,
    // Reihenfolge der versuchten Modelle und was zuletzt wirklich antwortete.
    modelChain: aiConfigured() ? modelChain("writing") : [],
    lastServedModel: lastServedModel(),
    sendEnabled: env.enableSend(),
    events
  });
}

// POST: prüft mit je einem winzigen Aufruf, welche Modelle dieser Zugang
// wirklich verwenden darf. Beantwortet eindeutig, ob z. B. Opus 5.5
// freigeschaltet ist – statt zu raten.
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) {
    return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht eingerichtet." }, { status: 503 });
  }
  // Eingestellte Kette plus die bekannten Modelle aus dem Katalog.
  const candidates = Array.from(new Set([...modelChain("writing"), ...Object.keys(MODEL_CATALOG)]));
  try {
    const results = await probeModels(candidates);
    return NextResponse.json({ configured: modelChain("writing")[0], results });
  } catch (e) {
    const info = aiErrorInfo(e);
    return NextResponse.json({ error: info.category, message: info.message }, { status: 502 });
  }
}

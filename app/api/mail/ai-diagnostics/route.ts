import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { recentAiEvents } from "@/lib/aiDiagnostics";
import { aiConfigured, lastServedModel } from "@/lib/anthropic";
import { env } from "@/lib/env";
import { modelChain } from "@/lib/aiModels";

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

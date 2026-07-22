import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Owner-eigene Diagnose der KI-Antwortfunktion. Speichert bewusst KEINE
// Schlüssel und KEINE vollständigen privaten Mailinhalte – nur Metadaten
// (Zeitpunkt, Erfolg, Dauer, Modell, Fehlerkategorie). Fällt still aus,
// falls die Tabelle (schema_ai.sql) noch nicht existiert – die eigentliche
// KI-Funktion darf davon nie abhängen.
export interface AiEventInput {
  userId: string;
  kind: "suggest" | "generate" | "refine" | "compose";
  ok: boolean;
  durationMs: number;
  model?: string | null;
  errorCategory?: string | null;
  subjectHint?: string | null; // nur gekürzter Betreff, kein Inhalt
}

export async function recordAiEvent(ev: AiEventInput): Promise<void> {
  try {
    await supabaseAdmin().from("ai_events").insert({
      user_id: ev.userId,
      kind: ev.kind,
      ok: ev.ok,
      duration_ms: Math.round(ev.durationMs),
      model: ev.model || null,
      error_category: ev.errorCategory || null,
      subject_hint: ev.subjectHint ? String(ev.subjectHint).slice(0, 80) : null
    });
  } catch {
    // Tabelle fehlt o. Ä. – Diagnose ist optional.
  }
}

export async function recentAiEvents(userId: string, limit = 20): Promise<any[]> {
  try {
    const { data } = await supabaseAdmin()
      .from("ai_events")
      .select("kind,ok,duration_ms,model,error_category,subject_hint,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data || [];
  } catch {
    return [];
  }
}

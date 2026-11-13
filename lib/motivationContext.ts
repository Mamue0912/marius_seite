// Serverseitige Lade-/Prüfhelfer für den Motivationsbereich.
// Hält Datenzugriffe aus lib/motivation.ts heraus (die bleibt rein testbar).

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PersonalExample, PersonalProfile } from "@/lib/motivation";

export interface LetterRow {
  id: string; user_id: string;
  institution: string; programme: string; intake: string | null;
  preset: string; language: string; title: string | null;
  outline: any; body: string; stage: string; last_check: any;
  created_at: string; updated_at: string;
}

/** Profil laden; fehlt es, ein leeres (kein Anlegen von Demo-Daten). */
export async function loadProfile(userId: string): Promise<PersonalProfile & { exists: boolean }> {
  const { data, error } = await supabaseAdmin()
    .from("motivation_profile").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Das Profil konnte nicht geladen werden.");
  if (!data) return { exists: false };
  const extra = (data.profile || {}) as Record<string, unknown>;
  return {
    exists: true,
    firstName: data.first_name,
    lastName: data.last_name,
    birthDate: data.birth_date,
    city: (extra.city as string) ?? null,
    school: (extra.school as string) ?? null,
    graduationYear: (extra.graduationYear as string) ?? null,
    grade: (extra.grade as string) ?? null,
    interests: (extra.interests as string) ?? null,
    goals: (extra.goals as string) ?? null,
    experiences: (extra.experiences as string) ?? null,
    planned: (extra.planned as string) ?? null
  };
}

/** Eigentümergeprüftes Laden eines Schreibens. */
export async function loadLetter(userId: string, id: string): Promise<LetterRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("motivation_letters").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Das Schreiben konnte nicht geladen werden.");
  return (data as LetterRow) || null;
}

export async function loadExamples(userId: string, letterId: string | null): Promise<PersonalExample[]> {
  let q = supabaseAdmin().from("motivation_examples").select("*").eq("user_id", userId);
  // Beispiele ohne Zuordnung gelten für alle Schreiben des Nutzers.
  q = letterId ? q.or(`letter_id.eq.${letterId},letter_id.is.null`) : q.is("letter_id", null);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error("Die persönlichen Beispiele konnten nicht geladen werden.");
  return (data || []).map((r: any) => ({
    questionKey: r.question_key,
    question: r.question,
    situation: r.situation,
    contribution: r.contribution,
    result: r.result,
    link: r.link,
    isPlanned: !!r.is_planned
  }));
}

/**
 * Speichert eine wiederherstellbare Version – aber nur, wenn sich der
 * Text wirklich geändert hat. Verhindert, dass Autosave die Historie flutet.
 */
export async function saveVersion(userId: string, letterId: string, body: string, label: string, origin: "auto" | "manuell" | "ki"): Promise<void> {
  if (!body.trim()) return;
  const { data } = await supabaseAdmin()
    .from("motivation_versions").select("body")
    .eq("user_id", userId).eq("letter_id", letterId)
    .order("created_at", { ascending: false }).limit(1);
  if (data?.[0]?.body === body) return;
  await supabaseAdmin().from("motivation_versions").insert({
    user_id: userId, letter_id: letterId, body, label, origin
  });
  // Historie begrenzen: die 30 jüngsten behalten.
  const { data: all } = await supabaseAdmin()
    .from("motivation_versions").select("id")
    .eq("user_id", userId).eq("letter_id", letterId)
    .order("created_at", { ascending: false });
  const stale = (all || []).slice(30).map((v: any) => v.id);
  if (stale.length) await supabaseAdmin().from("motivation_versions").delete().in("id", stale);
}

/** Begriffe, die der Nutzer ausdrücklich als "nur geplant" markiert hat. */
export function plannedTerms(profile: PersonalProfile, examples: PersonalExample[]): string[] {
  const terms: string[] = [];
  if (profile.planned) {
    for (const part of profile.planned.split(/[,;\n]/)) {
      const t = part.trim();
      if (t.length >= 4) terms.push(t);
    }
  }
  for (const e of examples) {
    if (!e.isPlanned) continue;
    const t = (e.situation || e.contribution || "").trim();
    if (t.length >= 4) terms.push(t.slice(0, 60));
  }
  return terms;
}

// ---------------------------------------------------------------------
//  Vorhandene Unterlagen als Tatsachenquelle
//
//  Der Motivationsbereich nutzt dieselben Unterlagen wie der
//  Bewerbungsbereich: bestätigte Fakten und die extrahierten Volltexte
//  der hochgeladenen Dateien. Dadurch muss der Nutzer nichts doppelt
//  eintragen.
// ---------------------------------------------------------------------

export interface SourceMaterial {
  factsText: string;
  documentsText: string;
  factCount: number;
  documents: { name: string; type: string | null }[];
}

const DOC_CHARS = 6000;   // je Dokument
const TOTAL_CHARS = 20000; // insgesamt, schützt das Zeitlimit

export async function loadSourceMaterial(userId: string): Promise<SourceMaterial> {
  const admin = supabaseAdmin();

  const { data: facts } = await admin
    .from("app_document_facts")
    .select("category,value")
    .eq("user_id", userId).eq("status", "bestaetigt")
    .order("category", { ascending: true });

  const byCat: Record<string, string[]> = {};
  for (const f of facts || []) (byCat[f.category] ||= []).push(f.value);
  const factsText = Object.entries(byCat).map(([c, v]) => `- ${c}: ${v.join("; ")}`).join("\n");

  const { data: docs } = await admin
    .from("app_documents")
    .select("name,doc_type,extracted_text,allowed_for_applications")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(12);

  const usable = (docs || []).filter((d: any) => d.allowed_for_applications !== false && (d.extracted_text || "").trim());
  const parts: string[] = [];
  let budget = TOTAL_CHARS;
  for (const d of usable) {
    if (budget <= 0) break;
    const text = String(d.extracted_text).trim().slice(0, Math.min(DOC_CHARS, budget));
    budget -= text.length;
    parts.push(`[${d.doc_type || "Unterlage"}] ${d.name}\n${text}`);
  }

  return {
    factsText,
    documentsText: parts.join("\n\n---\n\n"),
    factCount: (facts || []).length,
    documents: usable.map((d: any) => ({ name: d.name, type: d.doc_type }))
  };
}

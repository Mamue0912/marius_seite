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

// ---------------------------------------------------------------------
//  Evidence Database und Interview – serverseitige Zugriffe
// ---------------------------------------------------------------------

import type { EvidenceItem, FactStatus } from "@/lib/evidence";
import { FACT_STATUS } from "@/lib/evidence";

function rowToEvidence(r: any): EvidenceItem {
  return {
    id: r.id, title: r.title, period: r.period, role: r.role,
    situation: r.situation, challenge: r.challenge, decision: r.decision,
    action: r.action, result: r.result, learning: r.learning,
    businessLink: r.business_link,
    valueKeys: Array.isArray(r.value_keys) ? r.value_keys : [],
    status: (FACT_STATUS.includes(r.status) ? r.status : "USER_REPORTED") as FactStatus,
    source: r.source, interviewProbe: r.interview_probe
  };
}

export async function loadEvidence(userId: string): Promise<EvidenceItem[]> {
  const { data, error } = await supabaseAdmin()
    .from("motivation_evidence").select("*").eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("Die Erfahrungen konnten nicht geladen werden.");
  return (data || []).map(rowToEvidence);
}

export function evidenceToRow(userId: string, item: EvidenceItem): Record<string, unknown> {
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 4000) : null);
  return {
    user_id: userId,
    title: String(item.title || "").slice(0, 200),
    period: str(item.period), role: str(item.role),
    situation: str(item.situation), challenge: str(item.challenge),
    decision: str(item.decision), action: str(item.action),
    result: str(item.result), learning: str(item.learning),
    business_link: str(item.businessLink),
    value_keys: Array.isArray(item.valueKeys) ? item.valueKeys.slice(0, 8).map((v) => String(v).slice(0, 40)) : [],
    status: FACT_STATUS.includes(item.status) ? item.status : "USER_REPORTED",
    source: str(item.source), interview_probe: str(item.interviewProbe),
    updated_at: new Date().toISOString()
  };
}

export interface InterviewRow {
  id: string; question_key: string; question: string;
  answer: string | null; state: string; targets: string | null; created_at: string;
}

export async function loadInterview(userId: string, letterId?: string | null): Promise<InterviewRow[]> {
  let q = supabaseAdmin().from("motivation_interview").select("*").eq("user_id", userId);
  if (letterId) q = q.or(`letter_id.eq.${letterId},letter_id.is.null`);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error("Das Gespräch konnte nicht geladen werden.");
  return (data || []) as InterviewRow[];
}

/** Beantwortete Gesprächsantworten als Prompt-Material. */
export function interviewBlock(rows: InterviewRow[]): string {
  const answered = rows.filter((r) => r.state === "beantwortet" && (r.answer || "").trim());
  if (!answered.length) return "(noch keine Gesprächsantworten)";
  return answered.map((r) => `F: ${r.question}\nA: ${r.answer}`).join("\n\n");
}

/** Bereits gestellte Fragen – damit nichts doppelt gefragt wird. */
export function askedBlock(rows: InterviewRow[]): string {
  if (!rows.length) return "";
  return rows.map((r) => `- [${r.state}] ${r.question}`).join("\n");
}

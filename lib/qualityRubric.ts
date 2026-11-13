// =====================================================================
//  Qualitätsrubrik und Compliance-Prüfung
//
//  WICHTIG zur Einordnung: Die Punktwerte sind redaktionelle
//  Diagnosehilfen dieser Anwendung. Sie sind KEINE offiziellen
//  Zulassungsscores der Hochschule und sagen NICHTS über die
//  Annahmewahrscheinlichkeit aus.
//
//  Die Compliance-Prüfungen sind dagegen hart und deterministisch: sie
//  beruhen auf den offiziellen Vorgaben des Admissions-Profils.
// =====================================================================

import type { AdmissionsProfile } from "./admissions";
import { checkableRules } from "./admissions";
import { type EvidenceItem, plannedTitles, excludedTitles, findContradictions, isStoryReady, missingFields } from "./evidence";
import { paragraphs } from "./motivation";

export const RUBRIC_DIMENSIONS = [
  { key: "authentizitaet", label: "Authentizität" },
  { key: "tiefe", label: "Persönliche Tiefe" },
  { key: "bwl_motivation", label: "Glaubwürdige BWL-Motivation" },
  { key: "whu_motivation", label: "WHU-spezifische Motivation" },
  { key: "beispiele", label: "Konkrete persönliche Beispiele" },
  { key: "reflexion", label: "Reflexion und Entwicklung" },
  { key: "argumentation", label: "Stringente Argumentation" },
  { key: "sprache", label: "Sprachliche Qualität" },
  { key: "individualitaet", label: "Individualität" },
  { key: "interviewfestigkeit", label: "Interviewfestigkeit" }
] as const;

export type RubricKey = (typeof RUBRIC_DIMENSIONS)[number]["key"];

export interface RubricScore {
  key: RubricKey;
  label: string;
  score: number;         // 0–10
  justification: string; // was genau zu dieser Einschätzung führt
  quote?: string | null; // belegende Textstelle
  suggestion?: string | null;
}

export interface ComplianceCheck {
  id: string;
  label: string;
  status: "ok" | "fehlt" | "manuell";
  hint?: string;
}

// ---------------------------------------------------------------------
// Deterministische Compliance-Prüfungen
// ---------------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+\d[\d\s/()-]{6,}|\b\d[\d\s/()-]{6,}\d\b)/;

// Formulierungen, die ein Vorhaben als erledigt erscheinen lassen.
const DONE_MARKERS = [
  "habe ich absolviert", "habe ich abgeschlossen", "konnte ich sammeln", "sammelte ich",
  "während meines praktikums", "in meinem praktikum", "bei meinem praktikum",
  "ich arbeitete", "ich war tätig", "dort lernte ich", "dabei lernte ich"
];

export interface ComplianceInput {
  profile: AdmissionsProfile;
  body: string;
  evidence: EvidenceItem[];
  renderedPages: number | null;
  hasName: boolean;
  hasBirthDate: boolean;
}

/**
 * Harte Prüfungen gegen die offiziellen Vorgaben. Keine KI beteiligt –
 * das Ergebnis ist reproduzierbar.
 */
export function complianceChecks(input: ComplianceInput): ComplianceCheck[] {
  const { profile, body, evidence, renderedPages } = input;
  const text = body || "";
  const low = text.toLowerCase();
  const out: ComplianceCheck[] = [];

  // --- Inhaltliche Pflichtbestandteile des Profils ---
  const contentProbes: Record<string, string[]> = {
    motivation_subject: ["betriebswirtschaft", "bwl", "management", "business administration", "wirtschaft", "economics"],
    motivation_whu: ["whu", "otto beisheim", "vallendar"],
    self_description: ["stärke", "staerke", "schwäche", "schwaeche", "ziel", "eignung", "strength", "weakness", "goal"]
  };
  for (const req of profile.contentRequirements) {
    const probes = contentProbes[req.id] || [];
    const hit = probes.some((p) => low.includes(p));
    out.push({
      id: req.id, label: req.label,
      status: hit ? "ok" : "fehlt",
      hint: hit ? undefined : `${req.detail} – im Text nicht erkennbar.`
    });
  }

  // --- Formvorgaben ---
  for (const rule of checkableRules(profile)) {
    if (rule.id === "max_two_pages") {
      out.push(renderedPages == null
        ? { id: rule.id, label: rule.label, status: "manuell", hint: "Wird beim PDF-Export an den tatsächlich gesetzten Seiten geprüft." }
        : renderedPages <= profile.maxPages
          ? { id: rule.id, label: rule.label, status: "ok", hint: `${renderedPages} Seite(n) im PDF-Satz.` }
          : { id: rule.id, label: rule.label, status: "fehlt", hint: `Das PDF ergibt ${renderedPages} Seiten. Erlaubt sind höchstens ${profile.maxPages}.` });
      continue;
    }
    if (rule.id === "identity_line") {
      const ok = input.hasName && input.hasBirthDate;
      out.push({
        id: rule.id, label: rule.label, status: ok ? "ok" : "fehlt",
        hint: ok ? undefined : "Vorname, Nachname und Geburtsdatum müssen im Text stehen."
      });
      continue;
    }
    if (rule.id === "no_photo_no_contact") {
      const found: string[] = [];
      if (EMAIL_RE.test(text)) found.push("E-Mail-Adresse");
      if (PHONE_RE.test(text)) found.push("Telefonnummer");
      out.push(found.length
        ? { id: rule.id, label: rule.label, status: "fehlt", hint: `Bitte entfernen: ${found.join(", ")}.` }
        : { id: rule.id, label: rule.label, status: "ok" });
      continue;
    }
    if (rule.id === "file_name") {
      const ok = input.hasName;
      out.push({ id: rule.id, label: rule.label, status: ok ? "ok" : "fehlt", hint: ok ? "Der Export benennt die Datei automatisch." : "Für den Dateinamen werden Vor- und Nachname gebraucht." });
      continue;
    }
    out.push({ id: rule.id, label: rule.label, status: "manuell" });
  }

  // --- Geplantes darf nicht als erledigt klingen ---
  for (const title of plannedTitles(evidence)) {
    const t = title.toLowerCase();
    if (!low.includes(t)) continue;
    const idx = low.indexOf(t);
    // Nur die Umgebung der Fundstelle betrachten, nicht den ganzen Text.
    const around = low.slice(Math.max(0, idx - 220), idx + 220);
    const marker = DONE_MARKERS.find((m) => around.includes(m));
    out.push(marker
      ? {
        id: `planned_${t}`, label: `„${title}“ korrekt als geplant dargestellt`,
        status: "fehlt",
        hint: `Rund um „${title}“ steht „${marker}“. Das klingt nach einer abgeschlossenen Erfahrung. Bitte ausdrücklich als Vorhaben formulieren.`
      }
      : { id: `planned_${t}`, label: `„${title}“ korrekt als geplant dargestellt`, status: "ok" });
  }

  // --- Ausgeschlossenes (nur vermutet) darf gar nicht vorkommen ---
  for (const title of excludedTitles(evidence)) {
    const t = title.toLowerCase();
    if (t && low.includes(t)) {
      out.push({
        id: `excluded_${t}`, label: `Unbestätigtes „${title}“ nicht verwenden`,
        status: "fehlt",
        hint: `„${title}“ ist nur vermutet oder unbekannt, steht aber im Text. Bitte bestätigen oder streichen.`
      });
    }
  }

  // --- Widersprüche in der Datenlage ---
  for (const c of findContradictions(evidence)) {
    out.push({ id: `contradiction_${c.kind}`, label: "Widerspruch in den Angaben", status: "fehlt", hint: c.message });
  }

  // --- Unbelegte Behauptungen über die Hochschule ---
  const claimed = unverifiedInstitutionClaims(profile, text);
  for (const c of claimed) {
    out.push({
      id: `whu_claim_${c.slice(0, 20)}`, label: "Unbelegte Aussage über die Hochschule",
      status: "fehlt",
      hint: `„${c}“ lässt sich mit den hinterlegten offiziellen Angaben nicht belegen. Bitte durch ein nachprüfbares Merkmal ersetzen.`
    });
  }

  return out;
}

/**
 * Sucht Superlative über die Hochschule, die sich aus den hinterlegten
 * offiziellen Angaben nicht belegen lassen. Bewusst eng gefasst, damit
 * keine berechtigte Aussage fälschlich beanstandet wird.
 */
export function unverifiedInstitutionClaims(profile: AdmissionsProfile, body: string): string[] {
  const sentences = (body || "").split(/(?<=[.!?])\s+/);
  const factsLow = profile.programmeFacts.map((f) => f.fact.toLowerCase());
  const marketing = /\b(beste|besten|bester|führend|führende|weltweit anerkannt|renommiert|elite|exzellenteste|prestige|nummer eins|top-?universität|top-?hochschule)\b/i;
  const mentionsInstitution = /\b(whu|otto beisheim)\b/i;

  const out: string[] = [];
  for (const s of sentences) {
    if (!mentionsInstitution.test(s) || !marketing.test(s)) continue;
    // Steht die Aussage sinngemäß in den geprüften Angaben? Dann in Ordnung.
    const low = s.toLowerCase();
    const backed = factsLow.some((f) => {
      const keys = f.match(/[a-zäöüß]{7,}/g) || [];
      return keys.filter((k) => low.includes(k)).length >= 2;
    });
    if (!backed) out.push(s.trim().slice(0, 140));
  }
  return out;
}

// ---------------------------------------------------------------------
// Deterministische Stilhinweise (ohne KI)
// ---------------------------------------------------------------------

const BANNED_PHRASES = [
  "schon immer", "seit meiner kindheit", "von klein auf", "bereits früh", "bereits frueh",
  "brennende leidenschaft", "mit großer begeisterung", "renommiert", "exzellente reputation",
  "perfekter kandidat", "einzigartige gelegenheit", "dynamisches umfeld", "in der heutigen zeit",
  "nicht nur, sondern auch", "zusammenfassend lässt sich sagen"
];

const OVERUSED = ["leidenschaft", "exzellenz", "einzigartig", "begeisterung", "spannend"];

export interface StyleFinding { phrase: string; count: number; hint: string; }

export function styleFindings(body: string): StyleFinding[] {
  const low = (body || "").toLowerCase();
  const out: StyleFinding[] = [];

  for (const p of BANNED_PHRASES) {
    const count = low.split(p).length - 1;
    if (count > 0) out.push({ phrase: p, count, hint: "Austauschbare Formulierung – durch eine konkrete Beobachtung ersetzen." });
  }
  for (const w of OVERUSED) {
    const count = (low.match(new RegExp(`\\b${w}`, "g")) || []).length;
    if (count >= 3) out.push({ phrase: w, count, hint: `${count}-mal verwendet. Variieren oder durch eine Handlung zeigen statt benennen.` });
  }
  // Absätze, die nur aufzählen statt zu begründen.
  for (const p of paragraphs(body)) {
    const reasons = (p.match(/\b(weil|deshalb|dadurch|daher|sodass|damit)\b/gi) || []).length;
    const commas = (p.match(/,/g) || []).length;
    if (p.length > 260 && reasons === 0 && commas >= 4) {
      out.push({ phrase: p.slice(0, 60) + "…", count: 1, hint: "Dieser Absatz zählt auf, ohne zu begründen. Eine Schlussfolgerung ergänzen." });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Schablonen-Erkennung (ohne KI)
// ---------------------------------------------------------------------

/**
 * Ein Satz wirkt austauschbar, wenn er keinerlei Anker enthält: keinen
 * Eigennamen, keine Zahl, keinen konkreten Begriff. Solche Sätze könnten
 * in der Bewerbung jeder beliebigen Person stehen.
 */
export function isGenericSentence(sentence: string, anchors: string[]): boolean {
  const s = sentence.trim();
  // Kurze Sätze tragen oft nur die Überleitung – die sollen nicht stören.
  if (s.length < 55) return false;

  // Eine Zahl oder Jahreszahl ist ein Anker.
  if (/\d/.test(s)) return false;

  // Ein eigener Begriff des Bewerbers ist ein Anker: Projektname, Schule,
  // Studiengang, Modulname.
  //
  // Bewusst KEINE Grossschreibungs-Heuristik: im Deutschen werden alle
  // Substantive gross geschrieben, "Menschen" wäre sonst ein Eigenname.
  const low = s.toLowerCase();
  if (anchors.some((a) => a && a.trim().length >= 4 && low.includes(a.trim().toLowerCase()))) return false;

  return true;
}

export interface GenericFinding { sentence: string; hint: string; }

/**
 * Findet austauschbare Sätze. "anchors" sind die eigenen Begriffe des
 * Bewerbers (Titel der Erfahrungen, Schule, Studiengang).
 */
export function genericFindings(body: string, anchors: string[]): GenericFinding[] {
  const sentences = (body || "").split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const out: GenericFinding[] = [];
  for (const s of sentences) {
    if (isGenericSentence(s, anchors)) {
      out.push({
        sentence: s.trim().slice(0, 160),
        hint: "Dieser Satz könnte in jeder Bewerbung stehen. Durch eine konkrete Einzelheit aus deinen Erfahrungen ersetzen."
      });
    }
  }
  return out.slice(0, 8);
}

/**
 * Reicht die Datenlage überhaupt für einen persönlichen Text?
 * Fehlen Entscheidung, Handeln und Erkenntnis durchgehend, wird der Text
 * zwangsläufig allgemein – das soll die Anwendung VORHER sagen.
 */
export interface DepthWarning { ready: number; thin: { title: string; missing: string[] }[]; message: string | null; }

export function evidenceDepthWarning(items: EvidenceItem[]): DepthWarning {
  const usable = items.filter((i) => i.status === "CONFIRMED" || i.status === "USER_REPORTED" || i.status === "PLANNED");
  const ready = usable.filter(isStoryReady);
  const thin = usable
    .filter((i) => !isStoryReady(i))
    .map((i) => ({ title: i.title, missing: missingFields(i) }));

  let message: string | null = null;
  if (ready.length === 0) {
    message = "Keine deiner Erfahrungen ist bisher tief genug für einen persönlichen Absatz. Der Text bleibt deshalb allgemein. Am meisten bringt jetzt das Gespräch – dort werden Entscheidung, Handeln und Erkenntnis erfragt.";
  } else if (ready.length < 2) {
    message = "Erst eine Erfahrung ist tief genug. Zwei bis drei machen den Text deutlich überzeugender.";
  }
  return { ready: ready.length, thin, message };
}

// ---------------------------------------------------------------------
// Gesamtbild
// ---------------------------------------------------------------------

export interface QualityReport {
  scores: RubricScore[];
  /** Mittelwert, nur als grobe Orientierung. */
  average: number | null;
  compliance: ComplianceCheck[];
  style: StyleFinding[];
  /** Ausdrücklicher Hinweis, wie die Zahlen zu lesen sind. */
  disclaimer: string;
}

export const RUBRIC_DISCLAIMER =
  "Die Punktwerte sind eine redaktionelle Selbsteinschätzung dieser Anwendung. " +
  "Sie sind keine offizielle Bewertung der Hochschule und sagen nichts über deine Zulassungschance aus.";

export function averageScore(scores: RubricScore[]): number | null {
  const valid = scores.filter((s) => Number.isFinite(s.score));
  if (!valid.length) return null;
  return Math.round((valid.reduce((a, s) => a + s.score, 0) / valid.length) * 10) / 10;
}

/** Nur die Dimensionen, bei denen sich eine Überarbeitung wirklich lohnt. */
export function weakDimensions(scores: RubricScore[], threshold = 6): RubricScore[] {
  return scores.filter((s) => s.score < threshold).sort((a, b) => a.score - b.score);
}

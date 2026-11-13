// =====================================================================
//  Personal Evidence Database
//
//  Jede Erfahrung wird als geprüfter Datensatz geführt, nicht als freier
//  Text. Entscheidend ist der Faktenstatus: Die Schreib-Engine darf aus
//  einem GEPLANTEN Vorhaben niemals eine gemachte Erfahrung formen und
//  aus einer INFERRED-Deutung niemals eine Tatsache.
//
//  Reine Logik – keine Netz- oder Datenbankzugriffe, damit vollständig
//  testbar.
// =====================================================================

export type FactStatus =
  | "CONFIRMED"      // durch Unterlage oder ausdrückliche Bestätigung belegt
  | "USER_REPORTED"  // vom Nutzer berichtet, nicht weiter belegt
  | "PLANNED"        // geplant, noch NICHT absolviert
  | "INFERRED"       // plausible Deutung, unbestätigt
  | "UNKNOWN";       // nicht bekannt

export const FACT_STATUS: FactStatus[] = ["CONFIRMED", "USER_REPORTED", "PLANNED", "INFERRED", "UNKNOWN"];

export const FACT_STATUS_LABEL: Record<FactStatus, string> = {
  CONFIRMED: "Belegt",
  USER_REPORTED: "Selbst berichtet",
  PLANNED: "Geplant",
  INFERRED: "Vermutet",
  UNKNOWN: "Unbekannt"
};

export interface EvidenceItem {
  id?: string;
  /** Kurzname der Erfahrung, z. B. „Nacréa“. */
  title: string;
  /** Zeitraum als Freitext, z. B. „seit 2023“. */
  period?: string | null;
  /** Rolle und TATSÄCHLICHE Verantwortung. */
  role?: string | null;
  situation?: string | null;
  challenge?: string | null;
  /** Eigene Entscheidung. */
  decision?: string | null;
  /** Eigenes Handeln. */
  action?: string | null;
  /** Überprüfbare Ergebnisse. */
  result?: string | null;
  /** Persönliche Erkenntnis. */
  learning?: string | null;
  /** Bezug zu wirtschaftlichen Themen. */
  businessLink?: string | null;
  /** Mögliche Verbindung zu Werten der Hochschule (Schlüssel). */
  valueKeys?: string[];
  status: FactStatus;
  /** Woher stammt die Angabe (Dokumentname, „Nutzerangabe“, …). */
  source?: string | null;
  /** Womit könnte ein Interviewer nachhaken? */
  interviewProbe?: string | null;
}

// ---------------------------------------------------------------------
// Verwendbarkeit
// ---------------------------------------------------------------------

/**
 * Darf die Erfahrung als TATSACHE in den Text?
 * PLANNED darf nur als Vorhaben erscheinen, INFERRED/UNKNOWN gar nicht.
 */
export function usableAsFact(item: EvidenceItem): boolean {
  return item.status === "CONFIRMED" || item.status === "USER_REPORTED";
}

/** Muss ausdrücklich als Vorhaben formuliert werden. */
export function mustBeFramedAsPlanned(item: EvidenceItem): boolean {
  return item.status === "PLANNED";
}

/** Darf gar nicht in den Text. */
export function mustBeExcluded(item: EvidenceItem): boolean {
  return item.status === "INFERRED" || item.status === "UNKNOWN";
}

// ---------------------------------------------------------------------
// Gehaltvolle Erfahrungen erkennen
// ---------------------------------------------------------------------

/**
 * Wie belastbar ist der Datensatz für einen überzeugenden Absatz?
 * 0–6, zählt ausgefüllte erzählerische Felder. Bewusst ohne Gewichtung
 * nach Prestige – eine kleine, gut reflektierte Erfahrung soll eine
 * große, unreflektierte schlagen können.
 */
export function evidenceDepth(item: EvidenceItem): number {
  const fields = [item.situation, item.challenge, item.decision, item.action, item.result, item.learning];
  return fields.filter((f) => (f || "").trim().length >= 15).length;
}

/** Reicht es für einen eigenen Absatz? */
export function isStoryReady(item: EvidenceItem): boolean {
  return evidenceDepth(item) >= 3 && !mustBeExcluded(item);
}

/**
 * Was fehlt diesem Datensatz noch, um tragfähig zu sein?
 * Grundlage für die gezielten Rückfragen im Interview-Modus.
 */
export function missingFields(item: EvidenceItem): string[] {
  const gaps: string[] = [];
  const thin = (v?: string | null) => !(v || "").trim() || (v || "").trim().length < 15;
  if (thin(item.situation)) gaps.push("Ausgangssituation");
  if (thin(item.challenge)) gaps.push("Herausforderung");
  if (thin(item.decision)) gaps.push("eigene Entscheidung");
  if (thin(item.action)) gaps.push("eigenes Handeln");
  if (thin(item.result)) gaps.push("überprüfbares Ergebnis");
  if (thin(item.learning)) gaps.push("persönliche Erkenntnis");
  return gaps;
}

// ---------------------------------------------------------------------
// Auswahl der Geschichten (Stufe C der Pipeline)
// ---------------------------------------------------------------------

export interface StoryScore {
  item: EvidenceItem;
  depth: number;
  /** Erzählerische Vielfalt: deckt sie andere Werte ab als die bisherigen? */
  diversity: number;
  total: number;
}

/**
 * Wählt zwei bis vier Erfahrungen aus – nach Tiefe und argumentativer
 * Vielfalt, NICHT nach Prestige. Zwei Erfahrungen, die dasselbe belegen,
 * sind schwächer als zwei, die verschiedene Seiten zeigen.
 */
export function selectStories(items: EvidenceItem[], max = 4): EvidenceItem[] {
  const candidates = items.filter(isStoryReady);
  if (!candidates.length) return [];

  const chosen: EvidenceItem[] = [];
  const coveredValues = new Set<string>();

  while (chosen.length < Math.min(max, candidates.length)) {
    let best: StoryScore | null = null;
    for (const item of candidates) {
      if (chosen.includes(item)) continue;
      const keys = item.valueKeys || [];
      const fresh = keys.filter((k) => !coveredValues.has(k)).length;
      // Tiefe zählt doppelt, neue Wertebezüge einfach.
      const score: StoryScore = {
        item, depth: evidenceDepth(item), diversity: fresh,
        total: evidenceDepth(item) * 2 + fresh
      };
      if (!best || score.total > best.total) best = score;
    }
    if (!best) break;
    chosen.push(best.item);
    for (const k of best.item.valueKeys || []) coveredValues.add(k);
  }
  return chosen;
}

// ---------------------------------------------------------------------
// Widersprüche erkennen
// ---------------------------------------------------------------------

export interface Contradiction { kind: string; message: string; }

/**
 * Findet Widersprüche, die ein Interviewer bemerken würde.
 * Bewusst nur harte, nachvollziehbare Fälle – keine Stilkritik.
 */
export function findContradictions(items: EvidenceItem[]): Contradiction[] {
  const out: Contradiction[] = [];

  // 1) Dieselbe Erfahrung mit unterschiedlichem Status.
  const byTitle = new Map<string, EvidenceItem[]>();
  for (const i of items) {
    const key = (i.title || "").trim().toLowerCase();
    if (!key) continue;
    byTitle.set(key, [...(byTitle.get(key) || []), i]);
  }
  for (const [title, group] of byTitle) {
    const statuses = new Set(group.map((g) => g.status));
    if (statuses.has("PLANNED") && (statuses.has("CONFIRMED") || statuses.has("USER_REPORTED"))) {
      out.push({
        kind: "status",
        message: `„${group[0].title}“ ist einmal als geplant und einmal als bereits gemacht hinterlegt. Bitte klären – das fällt im Interview auf.`
      });
    }
    if (group.length > 1 && statuses.size === 1) {
      out.push({ kind: "duplikat", message: `„${group[0].title}“ ist mehrfach hinterlegt. Zusammenführen vermeidet Wiederholungen im Text.` });
    }
  }

  // 2) Geplantes mit Ergebnis: ein Vorhaben kann noch kein Ergebnis haben.
  for (const i of items) {
    if (i.status === "PLANNED" && (i.result || "").trim().length > 10) {
      out.push({
        kind: "geplant_mit_ergebnis",
        message: `„${i.title}“ ist als geplant markiert, hat aber ein Ergebnis hinterlegt. Entweder hat es stattgefunden, oder das Ergebnis gehört nicht dorthin.`
      });
    }
  }

  // 3) Vermutetes mit Ergebnis.
  for (const i of items) {
    if (i.status === "INFERRED" && ((i.result || "").trim() || (i.action || "").trim())) {
      out.push({
        kind: "vermutet_mit_detail",
        message: `„${i.title}“ ist nur vermutet, enthält aber konkrete Angaben. Bitte bestätigen oder entfernen – Vermutetes darf nicht in den Text.`
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------
// Prompt-Darstellung
// ---------------------------------------------------------------------

/**
 * Bereitet die Datensätze für das Modell auf – mit unmissverständlicher
 * Statuskennzeichnung je Eintrag.
 */
export function evidenceBlock(items: EvidenceItem[]): string {
  const usable = items.filter((i) => !mustBeExcluded(i));
  if (!usable.length) return "(keine belegten Erfahrungen hinterlegt)";

  return usable
    .map((i) => {
      const head = `### ${i.title}${i.period ? ` (${i.period})` : ""} — STATUS: ${i.status}`;
      const warn = i.status === "PLANNED"
        ? "ACHTUNG: NUR GEPLANT. Ausschliesslich als Vorhaben formulieren. Keine Erkenntnisse oder Ergebnisse daraus behaupten."
        : null;
      const rows = [
        warn,
        i.role ? `Rolle/Verantwortung: ${i.role}` : null,
        i.situation ? `Situation: ${i.situation}` : null,
        i.challenge ? `Herausforderung: ${i.challenge}` : null,
        i.decision ? `Eigene Entscheidung: ${i.decision}` : null,
        i.action ? `Eigenes Handeln: ${i.action}` : null,
        i.result ? `Ergebnis: ${i.result}` : null,
        i.learning ? `Erkenntnis: ${i.learning}` : null,
        i.businessLink ? `Wirtschaftlicher Bezug: ${i.businessLink}` : null,
        i.source ? `Quelle: ${i.source}` : null
      ].filter(Boolean);
      return [head, ...rows].join("\n");
    })
    .join("\n\n");
}

/** Begriffe, die nur als Vorhaben vorkommen dürfen. */
export function plannedTitles(items: EvidenceItem[]): string[] {
  return items.filter(mustBeFramedAsPlanned).map((i) => i.title).filter(Boolean);
}

/** Begriffe, die gar nicht vorkommen dürfen. */
export function excludedTitles(items: EvidenceItem[]): string[] {
  return items.filter(mustBeExcluded).map((i) => i.title).filter(Boolean);
}

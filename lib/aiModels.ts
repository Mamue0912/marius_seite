// =====================================================================
//  Zentrale Modellauswahl für alle KI-Aufrufe der Website.
//
//  WICHTIG: Modell-IDs stehen AUSSCHLIESSLICH hier – nicht verstreut im
//  Code. Jeder Zweck ist zusätzlich per Umgebungsvariable übersteuerbar,
//  damit ein Wechsel ohne Code-Änderung möglich ist.
//
//  Stand der Prüfung: 11.11.2026, offizielle Anthropic-Modellübersicht
//  (https://platform.claude.com/docs/en/about-claude/models/overview).
//  Es wurden nur Modelle übernommen, die dort als allgemein verfügbar
//  gelistet sind – keine angekündigten oder zugangsbeschränkten.
// =====================================================================

export type ModelPurpose =
  | "standard" // Allzweck: Analysen, Chat, Einordnung
  | "writing"  // Anspruchsvolle persönliche Texte (Motivationsschreiben, Anschreiben)
  | "fast";    // Hochvolumig/latenzkritisch: Klassifizierung, Extraktion

export interface ModelInfo {
  id: string;
  label: string;
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  contextTokens: number;
  maxOutputTokens: number;
}

// Geprüfter Katalog der aktuell allgemein verfügbaren Modelle.
// Quelle und Abrufdatum siehe Kopf dieser Datei.
export const MODEL_CATALOG: Record<string, ModelInfo> = {
  "claude-opus-5-5": {
    id: "claude-opus-5-5", label: "Claude Opus 5.5",
    inputPerMTokUsd: 4, outputPerMTokUsd: 20, contextTokens: 1_000_000, maxOutputTokens: 128_000
  },
  "claude-opus-5": {
    id: "claude-opus-5", label: "Claude Opus 5",
    inputPerMTokUsd: 5, outputPerMTokUsd: 25, contextTokens: 1_000_000, maxOutputTokens: 128_000
  },
  "claude-sonnet-5-5": {
    id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5",
    inputPerMTokUsd: 2, outputPerMTokUsd: 10, contextTokens: 1_000_000, maxOutputTokens: 128_000
  },
  "claude-haiku-5-5": {
    id: "claude-haiku-5-5", label: "Claude Haiku 5.5",
    inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.5, contextTokens: 1_000_000, maxOutputTokens: 128_000
  },
  "claude-fable-5-2": {
    id: "claude-fable-5-2", label: "Claude Fable 5.2",
    inputPerMTokUsd: 8, outputPerMTokUsd: 40, contextTokens: 1_000_000, maxOutputTokens: 128_000
  }
};

// Vorgaben je Zweck.
//
// Begründung der Auswahl (Stand 11.11.2026):
// - standard/writing = Claude Opus 5.5: laut offizieller Übersicht die
//   empfohlene Standardwahl, 1-Mio-Kontext, und mit $4/$20 je Mio. Token
//   GÜNSTIGER als das zuvor hinterlegte Claude Opus 4.8 ($5/$25).
// - fast = Claude Haiku 5.5: deutlich billiger und schneller; genügt für
//   Einordnung/Extraktion, wo kein feiner Schreibstil nötig ist.
// - Claude Fable 5.2 wäre für sehr lange agentische Ketten gedacht und
//   kostet das Doppelte – für Textarbeit kein Mehrwert, daher nicht gesetzt.
const DEFAULTS: Record<ModelPurpose, string> = {
  standard: "claude-opus-5-5",
  writing: "claude-opus-5-5",
  fast: "claude-haiku-5-5"
};

// Env-Namen je Zweck. ANTHROPIC_MODEL bleibt als Allzweck-Übersteuerung
// erhalten (Abwärtskompatibilität zu bestehenden Deployments).
const ENV_KEYS: Record<ModelPurpose, string[]> = {
  standard: ["ANTHROPIC_MODEL"],
  writing: ["ANTHROPIC_MODEL_WRITING", "ANTHROPIC_MODEL"],
  fast: ["ANTHROPIC_MODEL_FAST", "ANTHROPIC_MODEL"]
};

function fromEnv(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

// Liefert die zu verwendende Modell-ID für einen Zweck.
// Eine per Env gesetzte ID wird IMMER respektiert, auch wenn sie nicht im
// Katalog steht – so lässt sich ein neues Modell ohne Deploy einsetzen.
export function modelFor(purpose: ModelPurpose): string {
  return fromEnv(ENV_KEYS[purpose]) || DEFAULTS[purpose];
}

// Ausweichmodelle je Zweck. Greift NUR, wenn die API meldet, dass das
// gewählte Modell für diesen Zugang nicht existiert bzw. nicht freigegeben
// ist. Dann ist eine funktionierende Antwort mit einem anderen Modell
// besser als gar keine. Welches Modell tatsächlich geantwortet hat, steht
// in der KI-Diagnose.
const FALLBACKS: Record<ModelPurpose, string[]> = {
  standard: ["claude-sonnet-5-5", "claude-opus-4-8", "claude-sonnet-4-5"],
  writing: ["claude-sonnet-5-5", "claude-opus-4-8", "claude-sonnet-4-5"],
  fast: ["claude-haiku-4-5", "claude-sonnet-5-5"]
};

/**
 * Reihenfolge der zu versuchenden Modelle: zuerst das konfigurierte,
 * danach die Ausweichmodelle (ohne Doppelungen).
 */
export function modelChain(purpose: ModelPurpose): string[] {
  const first = modelFor(purpose);
  const chain = [first, ...FALLBACKS[purpose]];
  return chain.filter((m, i) => chain.indexOf(m) === i);
}

// Nur für Diagnose/Anzeige: Katalogeintrag, falls bekannt.
export function modelInfo(id: string): ModelInfo | null {
  return MODEL_CATALOG[id] || null;
}

// Antwortlänge je Zweck. Bewusst konservativ: ein Motivationsschreiben mit
// maximal zwei DIN-A4-Seiten braucht keine 128k Token, und eine kleinere
// Obergrenze schützt vor Zeitüberschreitungen.
export const MAX_TOKENS: Record<ModelPurpose, number> = {
  standard: 2000,
  writing: 4000,
  fast: 1200
};

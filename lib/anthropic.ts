import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

// Server-seitige KI-Generierung. Der API-Schlüssel liegt ausschließlich
// serverseitig (ANTHROPIC_API_KEY), niemals im Frontend.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.anthropicKey() });
  return _client;
}

export interface ThreadMessage {
  from: string;
  date: string;
  direction: "eingehend" | "gesendet";
  subject: string;
  body: string;
}

export interface Suggestion {
  label: string; // kurze Button-Beschriftung (3–5 Wörter)
  intent: string; // interne Absicht
  explanation: string; // kurze Erklärung
  binding: boolean; // verbindliche/sensible Zusage?
}

const CORE_RULES = `Du bist ein sorgfältiger E-Mail-Assistent. Absolute Regeln:
- Erfinde niemals Informationen. Übernimm Namen, Termine, Zahlen und Details exakt aus dem Thread.
- Mache KEINE Zusagen, die nicht ausdrücklich in der gewählten Reaktion oder Anweisung stehen.
- Ergänze keine zusätzlichen Forderungen, Bedingungen oder sensiblen Angaben.
- Verändere keine Empfänger; füge kein CC/BCC hinzu.
- Antworte höflich, natürlich und knapp – nicht wie ein KI-Standardtext, ohne übertriebene Begeisterung.
- Übernimm automatisch die Sprache der ursprünglichen E-Mail.
- Berücksichtige den bisherigen Gesprächsverlauf; wiederhole nichts bereits Geklärtes; stelle keine bereits beantwortete Frage erneut.
- Fehlt eine wichtige Information, erfinde sie nicht – formuliere stattdessen eine passende Rückfrage und melde die fehlende Information.`;

function renderThread(thread: ThreadMessage[]): string {
  return thread
    .map(
      (m) =>
        `[${m.direction}] ${m.date} — von ${m.from}\nBetreff: ${m.subject}\n${m.body}`
    )
    .join("\n\n---\n\n");
}

async function parseJson<T>(system: string, user: string, schema: any): Promise<T> {
  const res = await client().messages.create({
    model: env.anthropicModel(),
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
    // Strukturierte Ausgabe → garantiert parsebares JSON.
    output_config: { format: { type: "json_schema", schema } } as any
  });
  const text = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
  return JSON.parse(text) as T;
}

// 1) Drei dynamische, kontextabhängige Antwortvorschläge.
export async function generateSuggestions(
  thread: ThreadMessage[]
): Promise<{ language: string; suggestions: Suggestion[] }> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["language", "suggestions"],
    properties: {
      language: { type: "string" },
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "intent", "explanation", "binding"],
          properties: {
            label: { type: "string" },
            intent: { type: "string" },
            explanation: { type: "string" },
            binding: { type: "boolean" }
          }
        }
      }
    }
  };
  const system = `${CORE_RULES}

Aufgabe: Analysiere die E-Mail und den Verlauf und schlage GENAU DREI kurze, sinnvolle Reaktionsmöglichkeiten vor, passend zum konkreten Inhalt (z. B. Terminanfrage → "Termin passt / Alternativen vorschlagen / Termin absagen"; Jobangebot → "Angebot annehmen / Bedenkzeit erbitten / Höflich ablehnen"). Jede Beschriftung 3–5 Wörter. Setze binding=true, wenn die Option eine verbindliche/sensible Zusage bedeutet (z. B. Jobzusage/-absage, Vertragsannahme, verbindliche Terminbestätigung). Antworte in der Sprache der E-Mail.`;
  const user = `E-Mail-Thread:\n\n${renderThread(thread)}`;
  return parseJson(system, user, schema);
}

export interface DraftResult {
  subject: string;
  body: string;
  language: string;
  tone: string;
  binding: boolean;
  needs_attachment: boolean;
  missing_info: string | null;
}

// 2) Vollständiger, bearbeitbarer Entwurf aus gewählter Reaktion oder Freitext.
export async function generateDraft(params: {
  thread: ThreadMessage[];
  intent?: string; // gewählte Reaktion
  intentLabel?: string;
  customInstruction?: string; // "Eigene Antwort"
  tone: string; // Professionell | Freundlich | Kurz und direkt | Förmlich | Locker
}): Promise<DraftResult> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["subject", "body", "language", "tone", "binding", "needs_attachment", "missing_info"],
    properties: {
      subject: { type: "string" },
      body: { type: "string" },
      language: { type: "string" },
      tone: { type: "string" },
      binding: { type: "boolean" },
      needs_attachment: { type: "boolean" },
      missing_info: { type: ["string", "null"] }
    }
  };
  const intentLine = params.customInstruction
    ? `Meine Anweisung (Freitext): "${params.customInstruction}"`
    : `Gewählte Reaktion: "${params.intentLabel || params.intent}" (Absicht: ${params.intent})`;
  const system = `${CORE_RULES}

Aufgabe: Formuliere eine vollständige, sendefertige Antwort-E-Mail (nur Body als Fließtext, plus passenden Betreff, i. d. R. "Re: ...").
- Wähle den passenden Grad an Formalität; die gewünschte Tonalität ist: ${params.tone}.
- Automatische Tonwahl: formell bei Unternehmen/Behörden/Lehrern/Trainern/Unbekannten; professionell-freundlich bei Bewerbungen/beruflichem; lockerer bei bekannten Personen; kurz/direkt bei kurzer bisheriger Unterhaltung.
- setze binding=true, wenn die Antwort eine verbindliche/sensible Entscheidung enthält (Jobannahme/-absage, finanzielle/vertragliche/rechtliche Zusage, verbindliche Terminbestätigung, Weitergabe sensibler Infos).
- setze needs_attachment=true, wenn im Thread Unterlagen/Anhänge angefordert werden oder der Entwurf auf Anhänge verweist.
- missing_info: kurze Beschreibung fehlender wichtiger Angaben, sonst null. Erfinde nichts – bei fehlenden Angaben stattdessen eine Rückfrage in den Text aufnehmen.`;
  const user = `${intentLine}\n\nE-Mail-Thread:\n\n${renderThread(params.thread)}`;
  return parseJson(system, user, schema);
}

// 3) Kurzer Bearbeitungsbefehl (Kürzer/Freundlicher/…): verändert nur den Entwurf.
export async function refineDraft(params: {
  body: string;
  command: string;
  thread: ThreadMessage[];
}): Promise<{ body: string }> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["body"],
    properties: { body: { type: "string" } }
  };
  const system = `${CORE_RULES}

Aufgabe: Überarbeite NUR den vorliegenden Entwurf gemäß dem Befehl "${params.command}" (z. B. Kürzer, Freundlicher, Förmlicher, Direkter, Wärmer, Weniger begeistert, Mehr Kontext, Rechtschreibung prüfen). Ändere nichts an den zugesagten Inhalten und erfinde nichts Neues.`;
  const user = `Befehl: ${params.command}\n\nAktueller Entwurf:\n${params.body}\n\nZum Kontext der ursprüngliche Thread:\n${renderThread(params.thread)}`;
  return parseJson(system, user, schema);
}

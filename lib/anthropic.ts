import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

// Server-seitige KI-Generierung. Der API-Schlüssel liegt ausschließlich
// serverseitig (ANTHROPIC_API_KEY), niemals im Frontend.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.anthropicKey() });
  return _client;
}

// Ist die KI-Verbindung überhaupt eingerichtet? (ohne zu werfen)
export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Serverseitiges Zeitlimit für einen KI-Aufruf. Bewusst kleiner als das
// Vercel-Funktionslimit (maxDuration), damit wir eine verständliche Fehler-
// meldung zurückgeben, statt hart abgeschnitten zu werden.
const AI_TIMEOUT_MS = 38000;

export type AiErrorCategory = "not_configured" | "auth" | "rate_limit" | "timeout" | "overloaded" | "api_error";

export interface AiErrorInfo { category: AiErrorCategory; message: string; }

// Übersetzt einen KI-Fehler in eine verständliche Meldung – ohne je
// Schlüssel oder private Inhalte preiszugeben.
export function aiErrorInfo(e: any): AiErrorInfo {
  const msg = String(e?.message || e || "");
  const status = e?.status || e?.statusCode;
  if (!aiConfigured() || /Fehlende Umgebungsvariable: ANTHROPIC_API_KEY/i.test(msg)) {
    return { category: "not_configured", message: "Die KI-Verbindung ist noch nicht vollständig eingerichtet." };
  }
  if (status === 401 || status === 403 || /authentication|invalid x-api-key|permission/i.test(msg)) {
    return { category: "auth", message: "Der KI-Zugang wurde abgelehnt. Bitte den API-Schlüssel prüfen." };
  }
  if (status === 429 || /rate limit/i.test(msg)) {
    return { category: "rate_limit", message: "Die KI ist gerade ausgelastet. Bitte in einem Moment erneut versuchen." };
  }
  if (status === 529 || /overloaded/i.test(msg)) {
    return { category: "overloaded", message: "Die KI ist derzeit überlastet. Bitte gleich noch einmal versuchen." };
  }
  if (e?.name === "APIConnectionTimeoutError" || /timeout|timed out|aborted/i.test(msg)) {
    return { category: "timeout", message: "Die KI hat zu lange gebraucht. Der Vorgang wurde abgebrochen – bitte erneut versuchen." };
  }
  return { category: "api_error", message: "Die KI-Antwort konnte nicht erstellt werden. Bitte erneut versuchen." };
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
  // Fehlender Schlüssel: sofort mit klarer Kategorie werfen (kein 38-s-Hänger).
  if (!aiConfigured()) throw new Error("Fehlende Umgebungsvariable: ANTHROPIC_API_KEY");
  const res = await client().messages.create({
    model: env.anthropicModel(),
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
    // Strukturierte Ausgabe → garantiert parsebares JSON. output_config wird
    // vom SDK im Request-Body durchgereicht; das Cast umgeht nur die Typprüfung
    // der installierten SDK-Version.
    output_config: { format: { type: "json_schema", schema } }
  } as any, { timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  const text = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
  return JSON.parse(text) as T;
}

// 1) Drei dynamische, kontextabhängige Antwortvorschläge.
export async function generateSuggestions(
  thread: ThreadMessage[],
  accountContext?: string
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
  const ctx = accountContext ? `${accountContext}\n\n` : "";
  const user = `${ctx}E-Mail-Thread:\n\n${renderThread(thread)}`;
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
  length?: string; // optional: kurz | mittel | ausführlich
  accountContext?: string; // welches eigene Konto, privat/schulisch/beruflich
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
- missing_info: kurze Beschreibung fehlender wichtiger Angaben, sonst null. Erfinde nichts – bei fehlenden Angaben stattdessen eine Rückfrage in den Text aufnehmen.${params.length ? `\n- Gewünschte Länge: ${params.length}.` : ""}`;
  const ctx = params.accountContext ? `\n\nKontext zum eigenen Konto: ${params.accountContext}` : "";
  const user = `${intentLine}${ctx}\n\nE-Mail-Thread:\n\n${renderThread(params.thread)}`;
  return parseJson(system, user, schema);
}

// =====================================================================
// Gemeinsamer KI-Service (Mail, Stellenanalyse, Bewerbungs-Chat, Dokumente)
// Alle Aufrufe teilen Timeout (AI_TIMEOUT_MS), Retry und Fehlerkategorien.
// =====================================================================
export type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

async function rawJson<T>(system: string, content: string | Block[], schema: any, maxTokens = 2600): Promise<T> {
  if (!aiConfigured()) throw new Error("Fehlende Umgebungsvariable: ANTHROPIC_API_KEY");
  const res = await client().messages.create({
    model: env.anthropicModel(), max_tokens: maxTokens, system,
    messages: [{ role: "user", content: content as any }],
    output_config: { format: { type: "json_schema", schema } }
  } as any, { timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  const text = res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
  return JSON.parse(text) as T;
}

async function rawText(system: string, messages: any[], maxTokens = 2000): Promise<string> {
  if (!aiConfigured()) throw new Error("Fehlende Umgebungsvariable: ANTHROPIC_API_KEY");
  const res = await client().messages.create({
    model: env.anthropicModel(), max_tokens: maxTokens, system, messages
  } as any, { timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  return res.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
}

const APPLICATION_RULES = `Du bist ein sorgfältiger, ehrlicher Bewerbungs-Assistent. Absolute Regeln:
- Erfinde NIEMALS Fakten: keine Praktika, Noten, Fähigkeiten, Sprachkenntnisse, Berufserfahrung, Abschlüsse, sportliche Erfolge, Verfügbarkeiten oder Ansprechpartner.
- Verwende ausschließlich BESTÄTIGTE Fakten des Nutzers und den Inhalt der Stellenanzeige.
- Fehlt eine wichtige Angabe, stelle eine gezielte Rückfrage – fülle nichts Erfundenes ein.
- Keine künstlich genaue Prozentangabe bei Übereinstimmungen; nutze "starke Übereinstimmung", "teilweise Übereinstimmung", "offene Punkte".
- Schreibe natürlich, klar und ohne übertriebene Begeisterung. Deutsche Sprache, außer die Stelle verlangt ausdrücklich eine andere.`;

export interface JobAnalysis {
  job_type: "praktikum" | "nebenjob" | "ausbildung" | "stelle" | "unbekannt";
  company: string | null;
  position: string | null;
  summary: string;
  tasks: string[];
  requirements_must: string[];
  requirements_nice: string[];
  documents_required: string[];
  deadline: string | null;
  contact: string | null;
  application_tips: string[];
  matches_strong: string[];
  matches_partial: string[];
  open_points: string[];
  language: string;
}

// Stellenanzeige analysieren (Text oder Screenshot per Vision).
export async function analyzeJobPosting(input: {
  content: string | Block[];
  confirmedFactsText?: string;
}): Promise<JobAnalysis> {
  const schema = {
    type: "object", additionalProperties: false,
    required: ["job_type", "company", "position", "summary", "tasks", "requirements_must", "requirements_nice", "documents_required", "deadline", "contact", "application_tips", "matches_strong", "matches_partial", "open_points", "language"],
    properties: {
      job_type: { type: "string", enum: ["praktikum", "nebenjob", "ausbildung", "stelle", "unbekannt"] },
      company: { type: ["string", "null"] },
      position: { type: ["string", "null"] },
      summary: { type: "string" },
      tasks: { type: "array", items: { type: "string" } },
      requirements_must: { type: "array", items: { type: "string" } },
      requirements_nice: { type: "array", items: { type: "string" } },
      documents_required: { type: "array", items: { type: "string" } },
      deadline: { type: ["string", "null"] },
      contact: { type: ["string", "null"] },
      application_tips: { type: "array", items: { type: "string" } },
      matches_strong: { type: "array", items: { type: "string" } },
      matches_partial: { type: "array", items: { type: "string" } },
      open_points: { type: "array", items: { type: "string" } },
      language: { type: "string" }
    }
  };
  const facts = input.confirmedFactsText?.trim();
  const system = `${APPLICATION_RULES}

Aufgabe: Analysiere die folgende Stellenanzeige und erkläre sie verständlich.
- job_type: Praktikum, Nebenjob, Ausbildungsplatz, reguläre Stelle oder unbekannt.
- Erkenne Unternehmen und Position.
- tasks: welche Aufgaben erwarten die Person.
- requirements_must: zwingende Voraussetzungen. requirements_nice: nur wünschenswerte.
- documents_required: welche Unterlagen verlangt werden (Lebenslauf, Zeugnisse …).
- deadline: Bewerbungsfrist als ISO-Datum (YYYY-MM-DD), sonst kurzer Text, sonst null.
- contact: Ansprechpartner, sonst null.
- application_tips: worauf bei der Bewerbung besonders zu achten ist.
- matches_strong / matches_partial / open_points: NUR anhand der unten bestätigten Fakten. matches_strong = passt besonders gut, matches_partial = teilweise, open_points = Anforderungen, die aktuell nicht belegt sind. ${facts ? "" : "Wenn keine bestätigten Fakten vorliegen, gib in open_points den Hinweis, dass noch keine bestätigten Unterlagen vorhanden sind, und lasse matches_strong/matches_partial leer."}
- Erfinde nichts. Wenn etwas nicht in der Anzeige steht, lass es weg oder setze null.`;
  const factLine = facts ? `\n\nBestätigte Fakten des Nutzers (nur diese für die Übereinstimmung nutzen):\n${facts}` : "\n\n(Es liegen noch keine bestätigten Fakten vor.)";
  let content: string | Block[];
  if (typeof input.content === "string") {
    content = `Stellenanzeige:\n\n${input.content}${factLine}`;
  } else {
    content = [...input.content, { type: "text", text: `Bitte lies die Stellenanzeige aus dem Bild/den Bildern.${factLine}` }];
  }
  return rawJson<JobAnalysis>(system, content, schema, 2600);
}

// Fakten aus einem hochgeladenen Dokument extrahieren (Text oder Bild).
export async function extractDocumentFacts(input: { content: string | Block[] }): Promise<{ facts: { category: string; value: string }[] }> {
  const schema = {
    type: "object", additionalProperties: false, required: ["facts"],
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["category", "value"],
          properties: {
            category: { type: "string", enum: ["schule", "abschluss", "note", "praktikum", "erfahrung", "sprache", "projekt", "zertifikat", "sport", "faehigkeit", "sonstiges"] },
            value: { type: "string" }
          }
        }
      }
    }
  };
  const system = `${APPLICATION_RULES}

Aufgabe: Extrahiere aus dem Dokument NUR belegbare, tatsächlich enthaltene Fakten (Schule, Abschluss, Noten, Praktika, Erfahrungen, Sprachkenntnisse, Projekte, Zertifikate, sportliche Erfolge, Fähigkeiten). Erfinde nichts. Gib jede Angabe kurz und prägnant als eigenen Fakt zurück. Wenn nichts Belegbares erkennbar ist, gib eine leere Liste zurück.`;
  const content: string | Block[] = typeof input.content === "string"
    ? `Dokumentinhalt:\n\n${input.content}`
    : [...input.content, { type: "text", text: "Extrahiere belegbare Fakten aus dem Dokument/Bild." }];
  return rawJson(system, content, schema, 1800);
}

// Durchgehender Bewerbungs-Chat (Text) mit vollem Kontext.
export async function applicationChatReply(params: {
  jobContext: string;
  factsText: string;
  docsContext: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
}): Promise<string> {
  const system = `${APPLICATION_RULES}

Du bist der Chat-Assistent einer konkreten Bewerbung. Du hast Zugriff auf die Stellenausschreibung, die bestätigten Fakten des Nutzers und bereits erstellte Entwürfe. Beziehe dich darauf. Wenn dir für eine Antwort eine wichtige Angabe fehlt, frage konkret nach – erfinde nichts. Formuliere hilfreich und konkret.

=== STELLENAUSSCHREIBUNG / ANALYSE ===
${params.jobContext || "(noch keine Analyse vorhanden)"}

=== BESTÄTIGTE FAKTEN DES NUTZERS ===
${params.factsText || "(noch keine bestätigten Fakten)"}

=== BEREITS ERSTELLTE ENTWÜRFE DIESER BEWERBUNG ===
${params.docsContext || "(noch keine Entwürfe)"}`;
  const messages = [
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: params.userMessage }
  ];
  return rawText(system, messages, 1600);
}

// Chat über die hochgeladenen Unterlagen: erklärt, fragt bei Unklarheiten nach,
// nimmt Korrekturen des Nutzers entgegen. Nutzt Dokumentinhalte + Fakten.
export async function documentsChatReply(params: {
  docsContext: string;
  factsText: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
}): Promise<string> {
  const system = `${APPLICATION_RULES}

Du bist der Assistent für die persönlichen Unterlagen des Nutzers (Lebenslauf, Zeugnisse, Zertifikate usw.). Deine Aufgaben:
- Fragen zu den Dokumenten beantworten, ausschließlich anhand des unten stehenden Inhalts.
- Wenn etwas unklar oder widersprüchlich ist, stelle eine gezielte Rückfrage, statt zu raten.
- Nimm Korrekturen/Erklärungen des Nutzers ernst – wenn er sagt, dass du etwas falsch verstanden hast, übernimm seine Klarstellung.
- Erfinde keine Fakten. Wenn eine Information in den Unterlagen fehlt, sag das ehrlich und frage nach.

=== INHALT DER HOCHGELADENEN UNTERLAGEN ===
${params.docsContext || "(keine lesbaren Unterlagen vorhanden)"}

=== ERKANNTE / BESTÄTIGTE FAKTEN ===
${params.factsText || "(noch keine Fakten)"}`;
  const messages = [
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: params.userMessage }
  ];
  return rawText(system, messages, 1400);
}

// Bewerbungsdokument erstellen (Anschreiben, Motivation, Mail, Kurzprofil, Gespräch).
export interface AppDocResult { title: string; body: string; missing_info: string | null; }
export async function generateApplicationDocument(params: {
  kind: "anschreiben" | "motivation" | "bewerbungsmail" | "kurzprofil" | "gespraech";
  tone: string;
  jobContext: string;
  factsText: string;
  instruction?: string;
}): Promise<AppDocResult> {
  const schema = {
    type: "object", additionalProperties: false, required: ["title", "body", "missing_info"],
    properties: { title: { type: "string" }, body: { type: "string" }, missing_info: { type: ["string", "null"] } }
  };
  const kindLabel: Record<string, string> = {
    anschreiben: "ein vollständiges Bewerbungsanschreiben",
    motivation: "ein Motivationsschreiben",
    bewerbungsmail: "eine kurze, höfliche Bewerbungsmail (Anschreiben als Anhang erwähnen)",
    kurzprofil: "ein prägnantes Kurzprofil",
    gespraech: "eine strukturierte Vorbereitung auf das Vorstellungsgespräch (mögliche Fragen, gute Antwortansätze aus den bestätigten Fakten, eigene Rückfragen)"
  };
  const system = `${APPLICATION_RULES}

Aufgabe: Erstelle ${kindLabel[params.kind]}. Tonalität: ${params.tone}.
- Nutze ausschließlich die bestätigten Fakten und die Stellenanzeige. Erfinde nichts.
- body: sauberer Fließtext mit sinnvollen Absätzen (kein Markdown, keine Platzhalter wie "[Name]", wenn die Angabe fehlt – dann in missing_info vermerken).
- missing_info: kurz auflisten, welche wichtigen Angaben fehlen (sonst null).
${params.instruction ? `- Zusätzliche Anweisung des Nutzers: "${params.instruction}"` : ""}

=== STELLENAUSSCHREIBUNG / ANALYSE ===
${params.jobContext || "(keine Analyse vorhanden)"}

=== BESTÄTIGTE FAKTEN ===
${params.factsText || "(keine bestätigten Fakten)"}`;
  return rawJson<AppDocResult>(system, "Erstelle das Dokument jetzt.", schema, 2400);
}

// Generische Textüberarbeitung (kürzer, persönlicher, …) für Bewerbungsdokumente.
export async function refineText(params: { body: string; command: string; jobContext?: string; factsText?: string }): Promise<{ body: string }> {
  const schema = { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string" } } };
  const system = `${APPLICATION_RULES}

Aufgabe: Überarbeite NUR den vorliegenden Text gemäß Anweisung "${params.command}". Ändere keine zugesagten Inhalte, erfinde nichts Neues, behalte belegte Fakten bei.
${params.jobContext ? `\nStellenkontext:\n${params.jobContext}` : ""}
${params.factsText ? `\nBestätigte Fakten:\n${params.factsText}` : ""}`;
  return rawJson(system, `Anweisung: ${params.command}\n\nText:\n${params.body}`, schema, 2200);
}

// ---- Semantische Kategorien (getrennt von Ordnern & Priorität) ----
export const SEMANTIC_CATEGORIES = [
  "Wichtig", "Antwort erforderlich", "Schule", "Bewerbungen und Karriere",
  "Sport und Karate", "Reisen", "Termine und Veranstaltungen", "Rechnungen und Finanzen",
  "Bestellungen und Lieferungen", "Verträge und Versicherungen", "Behörden",
  "Konten und Sicherheit", "Persönlich", "Newsletter und Werbung",
  "Automatische Benachrichtigungen", "Sonstiges"
] as const;

export const ACTION_STATUSES = [
  "Sofort beantworten", "Heute beantworten", "Diese Woche beantworten",
  "Später beantworten", "Warten auf Antwort", "Nur zur Information", "Keine Aktion nötig"
] as const;

export interface ClassifyResult {
  category: string;
  action_status: string;
  priority: string; // normal | hoch | dringend
  needs_reply: boolean;
  confidence: number; // 0..1
}

export async function classifyEmail(input: {
  from_name?: string | null; from_address?: string | null; to?: string | null;
  subject?: string | null; body?: string | null; attachments?: string[]; accountLabel?: string | null;
}): Promise<ClassifyResult> {
  const schema = {
    type: "object", additionalProperties: false,
    required: ["category", "action_status", "priority", "needs_reply", "confidence"],
    properties: {
      category: { type: "string", enum: SEMANTIC_CATEGORIES as unknown as string[] },
      action_status: { type: "string", enum: ACTION_STATUSES as unknown as string[] },
      priority: { type: "string", enum: ["normal", "hoch", "dringend"] },
      needs_reply: { type: "boolean" },
      confidence: { type: "number" }
    }
  };
  const system = `Du kategorisierst eine einzelne E-Mail. Getrennt zu bewerten:
1) semantische Kategorie (Inhalt/Bedeutung) aus der Liste,
2) action_status (brauche ich eine Handlung?),
3) priority (normal/hoch/dringend),
4) needs_reply (muss ich antworten?),
5) confidence (0..1 – wie sicher bist du bei der Kategorie).
Regeln:
- Analysiere Absendername, Absenderdomain, Empfängeradresse (eigenes Konto), Betreff, Text und Anhang-Dateinamen im Zusammenhang – nicht nur einzelne Wörter.
- Karateverbände/Trainer/Wettkampfplattformen → "Sport und Karate". Praktika/Bewerbungsrückmeldungen → "Bewerbungen und Karriere". Lehrer/Schule → "Schule". Flug/Hotel/Buchung → "Reisen". Rechnungen/Zahlungen/Kontoauszüge → "Rechnungen und Finanzen". Paketankündigungen → "Bestellungen und Lieferungen". Anmeldecodes/Sicherheitswarnungen → "Konten und Sicherheit". Werbung → "Newsletter und Werbung". Automatische Systemmails → "Automatische Benachrichtigungen".
- "Sport und Karate" heißt NICHT automatisch wichtig/dringend.
- Bei Unsicherheit "Sonstiges" und niedrige confidence. Erfinde keine Sicherheit.`;
  const atts = input.attachments?.length ? `\nAnhänge: ${input.attachments.join(", ")}` : "";
  const user = `Eigenes Empfänger-Konto: ${input.accountLabel || "unbekannt"}
Von: ${input.from_name || ""} <${input.from_address || ""}>
An: ${input.to || ""}
Betreff: ${input.subject || ""}${atts}
Text (gekürzt):
${(input.body || "").slice(0, 2500)}`;
  return parseJson(system, user, schema);
}

// ---- Neue E-Mail aus kurzer Anweisung verfassen ----
export async function composeNew(params: {
  instruction: string; fromAccountLabel?: string; recipientHint?: string;
}): Promise<DraftResult> {
  const schema = {
    type: "object", additionalProperties: false,
    required: ["subject", "body", "language", "tone", "binding", "needs_attachment", "missing_info"],
    properties: {
      subject: { type: "string" }, body: { type: "string" }, language: { type: "string" },
      tone: { type: "string" }, binding: { type: "boolean" },
      needs_attachment: { type: "boolean" }, missing_info: { type: ["string", "null"] }
    }
  };
  const system = `${CORE_RULES}

Aufgabe: Formuliere eine NEUE, sendefertige E-Mail (Betreff + Body als Fließtext) aus meiner kurzen Anweisung.
- Passe Formalität an Empfänger/Anlass an. Erfinde keine Fakten, Termine oder Namen; fehlt Wichtiges, formuliere eine Rückfrage und melde es in missing_info.
- binding=true bei verbindlichen/sensiblen Aussagen. needs_attachment=true, wenn Unterlagen erwähnt werden.`;
  const user = `Absender-Konto: ${params.fromAccountLabel || "eigenes Konto"}
${params.recipientHint ? `Empfänger-Hinweis: ${params.recipientHint}\n` : ""}Anweisung: ${params.instruction}`;
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

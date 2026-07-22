// Deterministische, mehrdimensionale E-Mail-Klassifizierung.
// Schnell, kostenlos, ohne KI-Aufruf – ideal für die einmalige Nachklassifizierung
// vieler bestehender Mails und für jede neue Mail beim Sync.
// Bestimmt getrennt: Labels[], Nachrichtentyp, Handlungsbedarf, Relevanz,
// needs_reply, Priorität + eine kurze Zusammenfassung.

export interface ClassifyInput {
  from_address?: string | null;
  from_name?: string | null;
  reply_to?: string | null;
  subject?: string | null;
  preview?: string | null;
  is_bulk?: boolean | null;
  has_list_unsub?: boolean | null;
  folder_type?: string | null;
  in_thread?: boolean | null; // Teil eines echten Threads (Antwort)
}

export interface ClassifyResult {
  labels: string[];
  message_type: string;   // siehe MESSAGE_TYPES
  action_status: string;  // Handlungsbedarf
  relevance: string;      // sehr_wichtig | wichtig | normal | niedrig | irrelevant
  priority: string;       // dringend | hoch | normal | niedrig
  needs_reply: boolean;
  summary: string;
}

// --- Schlüsselwörter -------------------------------------------------------
const R = {
  karate: /(karate|\bdkv\b|deutscher karate|karate\.de|sportdata|kumite|\bkata\b|kader|lehrgang|kaderlehrgang|nationalmannschaft|wettkampf|meisterschaft|youth league|basel open|dojo|\bbudo\b|gürtelprüfung|\bdan\b|\bkyu\b|trainer|verband)/i,
  payment: /(paypal|rechnung|zahlung|payment|invoice|beleg|quittung|receipt|lastschrift|überweisung|kontoauszug|mahnung|betrag|abbuchung|kauf|purchase|order confirmation)/i,
  travel: /(flug|flight|hotel|booking|reise|bahn|deutsche bahn|ryanair|lufthansa|airbnb|check-in|boarding|reservierung|reservation|buchung|unterkunft|mietwagen)/i,
  travelChange: /(storniert|stornierung|cancel(l?)ed|cancellation|geändert|changed|umbuchung|verschoben|rebooked|refund|erstattung|verspätung|delayed|annulliert)/i,
  security: /(sicherheitswarnung|security alert|verdächtig|suspicious|unbekannt(e|er)? (login|anmeldung|gerät)|new (sign-?in|device|login)|neues gerät|neue anmeldung|2fa|zwei-faktor|verifizierung|bestätigungscode|verification code|einmalcode|one-?time|otp|passwort zurücksetzen|reset your password)/i,
  securityBenign: /(passwort (wurde )?geändert|password (was )?(changed|updated)|erfolgreich geändert|successfully (changed|updated)|änderung bestätigt|wurde aktualisiert)/i,
  welcome: /(welcome to|willkommen bei|willkommen im|get started|erste schritte|confirm your email|verify your email|bestätige deine e-?mail|e-?mail bestätigen|konto erstellt|account created|thanks for signing up|registrierung)/i,
  survey: /(umfrage|feedback|bewerten|bewertung|wie war|wie zufrieden|how did we do|rate your|review your|share your|zufriedenheit|deine meinung|your experience|erlebnis|nps)/i,
  newsletter: /(newsletter|angebot|angebote|sale|rabatt|% rabatt|deal|deals|gewinnspiel|jetzt kaufen|jetzt sichern|nur heute|black friday|aktion|gutschein|voucher|prozent)/i,
  order: /(bestellung|order|versand|shipping|lieferung|paket|sendungsverfolgung|tracking|zugestellt|delivered|amazon|zalando|\bdhl\b|hermes|\bdpd\b|\bgls\b|otto)/i,
  job: /(bewerbung|praktikum|stellenangebot|jobangebot|stellenausschreibung|karriere|career|stepstone|indeed|vorstellungsgespräch|interview|recruiting|personalabteilung|ausbildungsplatz|werkstudent|absage|zusage)/i,
  school: /(schule|gymnasium|lehrer|lehrerin|unterricht|klassenarbeit|klausur|zeugnis|elternabend|schulportal|moodle|itslearning|abitur|hausaufgabe)/i,
  subscription: /(netflix|spotify|abo\b|abonnement|subscription|prime|disney\+|youtube premium|icloud\+|adobe|mitgliedschaft|membership|vertrag verlängert|renewal|verlängerung)/i,
  appointment: /(termin|einladung|meeting|besprechung|kalender|arzttermin|zusage|absage|calendar invite|save the date)/i,
  spam: /(viagra|casino|lottery|lotto|you (have )?won|sie haben gewonnen|prince|inheritance|erbschaft|bitcoin.{0,12}(double|verdoppeln)|crypto.{0,10}profit|hot singles|xxx)/i,
  question: /\?|kannst du|könntest du|könnten sie|bitte um|rückmeldung|melde dich|gib bescheid|bräuchte|benötige ich|bis wann|wann passt|hättest du|wärst du|lass es mich wissen/i,
  registration: /(anmeldung|anmelden|registrier|meldeschluss|startgeld|nenngeld|teilnahme|einschreib)/i
};

const NOREPLY = /(no-?reply|noreply|do-?not-?reply|donotreply|mailer-daemon|bounce|notifications?@|automated?@|mailer@|newsletter@|marketing@|info@|hello@|team@|support@)/i;

function has(re: RegExp, s: string) { return re.test(s); }

export function classifyMessage(input: ClassifyInput): ClassifyResult {
  const from = (input.from_address || "").toLowerCase();
  const name = input.from_name || "";
  const subj = input.subject || "";
  const prev = input.preview || "";
  const hay = `${name} ${from} ${subj} ${prev}`;
  const bulk = !!(input.is_bulk || input.has_list_unsub);
  const noReply = NOREPLY.test(from);
  const inThread = !!input.in_thread;

  // ---- Inhaltliche Labels (mehrfach möglich) ----
  const labels = new Set<string>();
  if (has(R.karate, hay)) labels.add("Karate");
  if (has(R.job, hay)) labels.add("Bewerbungen");
  if (has(R.payment, hay)) labels.add("Zahlungen");
  if (has(R.subscription, hay)) labels.add("Abonnements");
  if (has(R.travel, hay)) labels.add("Reisen");
  if (has(R.order, hay)) labels.add("Bestellungen");
  if (has(R.school, hay)) labels.add("Schule");
  if (has(R.security, hay) || has(R.securityBenign, hay)) labels.add("Sicherheit");
  if (has(R.appointment, hay)) labels.add("Termine");

  // ---- Nachrichtentyp ----
  let type = "unknown";
  if (input.folder_type === "sent") type = "personal_direct";
  else if (has(R.spam, hay)) type = "spam";
  else if (has(R.security, hay) && !has(R.securityBenign, hay)) type = "security_alert";
  else if (has(R.securityBenign, hay)) type = "system_notification";
  else if (has(R.travel, hay) && has(R.travelChange, hay)) type = "booking_change";
  else if (has(R.payment, hay) && (bulk || noReply || has(R.order, hay))) type = "invoice_receipt";
  else if (has(R.survey, hay) && (bulk || noReply)) type = "survey_feedback";
  else if (has(R.welcome, hay) && (bulk || noReply)) type = "welcome";
  else if (has(R.job, hay) && !bulk && !noReply) type = "job_offer";
  else if (has(R.order, hay) && (bulk || noReply)) type = "auto_confirmation";
  else if (bulk && has(R.newsletter, hay)) type = "marketing";
  else if (bulk) type = "newsletter";
  else if (noReply) type = "system_notification";
  else type = inThread ? "personal_thread" : "personal_direct";

  // Karate-Massenmails trotzdem als solche behandeln, Label bleibt „Karate".
  // ---- Typ-abgeleitete Labels ----
  if (type === "newsletter" || type === "marketing") labels.add("Newsletter");
  if (type === "survey_feedback") labels.add("Newsletter");
  if (["system_notification", "welcome", "auto_confirmation"].includes(type)) labels.add("Automatisch");
  if (type === "invoice_receipt") labels.add("Zahlungen");
  if (type === "booking_change") labels.add("Reisen");
  if (type === "security_alert") labels.add("Sicherheit");
  if (type === "job_offer") labels.add("Bewerbungen");
  if (type === "personal_direct" || type === "personal_thread") labels.add("Persönlich");
  if (labels.size === 0) labels.add("Sonstiges");

  // ---- Handlungsbedarf / needs_reply / Relevanz ----
  let action = "information_only";
  let needs = false;
  let relevance = "normal";

  const personalQuestion = has(R.question, `${subj} ${prev}`);
  switch (type) {
    case "security_alert":
      action = "act_now"; relevance = "sehr_wichtig"; needs = false; break;
    case "booking_change":
      action = "review_recommended"; relevance = "wichtig"; needs = false; break;
    case "invoice_receipt":
      action = "information_only"; relevance = "normal"; needs = false; break;
    case "survey_feedback":
      action = "no_action"; relevance = "irrelevant"; needs = false; break;
    case "newsletter":
    case "marketing":
      action = "no_action"; relevance = "niedrig"; needs = false; break;
    case "welcome":
    case "system_notification":
    case "auto_confirmation":
      action = "no_action"; relevance = "niedrig"; needs = false; break;
    case "spam":
      action = "irrelevant"; relevance = "irrelevant"; needs = false; break;
    case "job_offer":
      action = "reply_required"; relevance = "wichtig"; needs = true; break;
    case "personal_direct":
    case "personal_thread":
      if (input.folder_type === "sent") { action = "awaiting_reply"; relevance = "normal"; needs = false; }
      else { needs = !noReply && !bulk; action = needs ? "reply_required" : "information_only"; relevance = needs ? "wichtig" : "normal"; }
      break;
    default:
      action = "review_recommended"; relevance = "normal"; needs = false;
  }

  // Karate-Feinjustierung.
  if (labels.has("Karate") && input.folder_type !== "sent") {
    if (has(R.registration, hay) || has(R.payment, hay)) { action = "action_no_reply"; relevance = relevance === "niedrig" ? "normal" : relevance; }
    else if (personalQuestion && !bulk && !noReply) { action = "reply_required"; needs = true; relevance = "wichtig"; }
    else if (bulk || noReply) { action = "information_only"; }
  }

  const priority = relevance === "sehr_wichtig" ? "dringend" : relevance === "wichtig" ? "hoch" : relevance === "irrelevant" ? "niedrig" : relevance === "niedrig" ? "niedrig" : "normal";

  return {
    labels: Array.from(labels),
    message_type: type,
    action_status: action,
    relevance, priority, needs_reply: needs,
    summary: summarize(type, action, needs, subj)
  };
}

function summarize(type: string, action: string, needs: boolean, subject: string): string {
  const s = subject ? `„${subject.slice(0, 60)}": ` : "";
  switch (type) {
    case "invoice_receipt": return "Automatischer Kaufbeleg/Rechnung. Keine Antwort erforderlich.";
    case "booking_change": return `${s}Buchungsänderung – bitte Rückerstattung und Reiseplanung prüfen.`;
    case "security_alert": return "Sicherheitswarnung – bitte prüfen, ob du das selbst ausgelöst hast.";
    case "welcome": return "Willkommens-/Registrierungsmail. Keine Aktion nötig.";
    case "system_notification": return "Automatische Systembenachrichtigung. Keine Aktion nötig.";
    case "auto_confirmation": return "Bestell-/Versandbestätigung. Nur zur Information.";
    case "survey_feedback": return "Feedback-/Umfragemail. Keine Antwort erforderlich.";
    case "newsletter": return "Newsletter. Keine Aktion nötig.";
    case "marketing": return "Werbung/Angebot. Keine Aktion nötig.";
    case "job_offer": return `${s}Bewerbung/Jobangebot – prüfen und ggf. antworten.`;
    case "spam": return "Vermutlich Spam.";
    case "personal_thread":
    case "personal_direct": return needs ? "Persönliche Nachricht – eine Antwort ist sinnvoll." : "Persönliche Nachricht – zur Kenntnis.";
    default: return needs ? "Vermutlich wird eine Antwort erwartet." : "Nur zur Information.";
  }
}

// Anzeige-Kurztexte für Chips.
export const ACTION_LABEL: Record<string, string> = {
  act_now: "Sofort prüfen",
  reply_required: "Antwort nötig",
  action_no_reply: "Handlung nötig",
  review_recommended: "Prüfen",
  awaiting_reply: "Warte auf Antwort",
  information_only: "Nur Info",
  no_action: "Keine Aktion",
  irrelevant: "Irrelevant"
};
export const RELEVANCE_LABEL: Record<string, string> = {
  sehr_wichtig: "Sehr wichtig", wichtig: "Wichtig", normal: "Normal", niedrig: "Niedrig", irrelevant: "Irrelevant"
};

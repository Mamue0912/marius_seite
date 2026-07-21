// Bestimmt den Nachrichtentyp anhand von Headern + Absender + Betreff.
// Eine Namensanrede beweist NICHT, dass eine Mail persönlich ist.

export interface TypeSignals {
  headers?: Record<string, string>; // lowercased keys
  from_address?: string | null;
  subject?: string | null;
  folder?: string;
}

export interface TypeResult {
  message_type: string;
  is_bulk: boolean;
  has_list_unsub: boolean;
  needs_reply: boolean;
  action_status: string;
  priority: string; // dringend | hoch | normal | niedrig
}

const SURVEY = /(umfrage|feedback|bewert|zufrieden|wie war|wie zufrieden|survey|rate your|review your|how did we do|erlebnis|experience)/i;
const SECURITY = /(sicherheitscode|verifizierung|verify|bestätigungscode|login|anmeldung|password|passwort|code:|security|2fa|zwei-faktor)/i;
const TRANSACTIONAL = /(rechnung|beleg|quittung|zahlung|payment|receipt|invoice|bestellung|order|versand|shipping|lieferung|buchung|booking|bestätigung)/i;

export function detectType(s: TypeSignals): TypeResult {
  const h = s.headers || {};
  const from = (s.from_address || "").toLowerCase();
  const subj = s.subject || "";

  const hasListUnsub = !!(h["list-unsubscribe"] || h["list-id"]);
  const precedence = (h["precedence"] || "").toLowerCase();
  const autoSubmitted = (h["auto-submitted"] || "").toLowerCase();
  const feedbackId = !!h["feedback-id"] || !!h["x-feedback-id"];
  const isNoReply = /(no-?reply|noreply|do-?not-?reply|donotreply|mailer-daemon|bounce)/.test(from);
  const isBulk = hasListUnsub || precedence === "bulk" || precedence === "list" || autoSubmitted.includes("auto-generated") || feedbackId;

  // Sent-Ordner: nichts zu tun.
  if (s.folder === "sent") {
    return { message_type: "personal_direct", is_bulk: false, has_list_unsub: false, needs_reply: false, action_status: "no_action", priority: "niedrig" };
  }

  let type = "unknown";
  if (SURVEY.test(subj) && (isBulk || isNoReply || feedbackId)) type = "survey_feedback";
  else if (SECURITY.test(subj) || /(security|verify|account)/.test(from)) type = "security_notification";
  else if (isBulk && /(newsletter|angebot|sale|rabatt|deal|marketing|% )/i.test(subj)) type = "newsletter_marketing";
  else if (isBulk) type = "newsletter_marketing";
  else if (TRANSACTIONAL.test(subj) && (isNoReply || autoSubmitted)) type = "transactional";
  else if (isNoReply || autoSubmitted.includes("auto")) type = "system_notification";
  else type = "personal_direct";

  // Umfragen/Feedback von Massenversendern: NIE antwortpflichtig.
  let needs_reply = false;
  let action_status = "information_only";
  let priority = "niedrig";

  switch (type) {
    case "survey_feedback":
    case "newsletter_marketing":
    case "automated_bulk":
      needs_reply = false; action_status = "no_action"; priority = "niedrig"; break;
    case "transactional":
      needs_reply = false; action_status = "information_only"; priority = "normal"; break;
    case "security_notification":
      needs_reply = false; action_status = "review_recommended"; priority = "hoch"; break;
    case "system_notification":
      needs_reply = false; action_status = "no_action"; priority = "niedrig"; break;
    case "personal_direct":
      // Nur echte persönliche Mails können antwortpflichtig sein – finale
      // Feinbewertung macht die KI; hier vorsichtiger Standard.
      needs_reply = !isBulk && !isNoReply;
      action_status = needs_reply ? "review_recommended" : "information_only";
      priority = "normal"; break;
  }

  return { message_type: type, is_bulk: isBulk, has_list_unsub: hasListUnsub, needs_reply, action_status, priority };
}

// Leichte, regelbasierte Mehrfach-Labels aus Absender/Domain/Betreff/Typ.
// Ergänzt (nicht ersetzt) die KI-Inhaltskategorie. Nutzer-Labels haben Vorrang.

const RULES: { label: string; re: RegExp }[] = [
  { label: "Karate", re: /(karate|\bdkv\b|deutscher karate|sportdata|kumite|\bkata\b|kaderlehrgang|lehrgang|nationalmannschaft|wettkampf|meisterschaft|youth league|basel open|dojo|\bbudo\b|karate\.de|trainer)/i },
  { label: "Bewerbungen", re: /(bewerbung|praktikum|stellenangebot|jobangebot|karriere|lebenslauf|anschreiben|stepstone|indeed|linkedin|vorstellungsgespräch|recruiting|personalabteilung)/i },
  { label: "Zahlungen", re: /(paypal|rechnung|zahlung|payment|invoice|beleg|quittung|lastschrift|überweisung|kontoauszug|mahnung|betrag)/i },
  { label: "Abonnements", re: /(netflix|spotify|abo|abonnement|mitgliedschaft|subscription|prime|disney|youtube premium|icloud\+|adobe)/i },
  { label: "Bestellungen", re: /(bestellung|order|versand|shipping|lieferung|paket|sendungsverfolgung|amazon|zalando|dhl|hermes|dpd)/i },
  { label: "Reisen", re: /(flug|hotel|buchung|booking|reise|bahn|deutsche bahn|ryanair|lufthansa|airbnb|check-in|boarding)/i },
  { label: "Schule", re: /(schule|gymnasium|lehrer|unterricht|klassenarbeit|zeugnis|elternabend|schulportal|moodle|itslearning)/i },
  { label: "Sicherheit", re: /(sicherheitscode|verifizierung|bestätigungscode|login|anmeldung|passwort zurücksetzen|2fa|verdächtig|security alert|neues gerät)/i },
  { label: "Termine", re: /(termin|einladung|meeting|besprechung|kalender|arzttermin|zusage|absage)/i }
];

export function autoLabels(input: { from_address?: string | null; from_name?: string | null; subject?: string | null; preview?: string | null; message_type?: string | null; needs_reply?: boolean }): string[] {
  const hay = `${input.from_name || ""} ${input.from_address || ""} ${input.subject || ""} ${input.preview || ""}`;
  const out = new Set<string>();
  for (const r of RULES) if (r.re.test(hay)) out.add(r.label);

  const t = input.message_type;
  if (t === "newsletter_marketing") out.add("Newsletter");
  if (t === "survey_feedback" || t === "system_notification" || t === "automated_bulk") out.add("Automatisch");
  if (t === "security_notification") out.add("Sicherheit");
  if (t === "personal_direct") out.add("Persönlich");
  if (input.needs_reply) out.add("Antwort nötig");

  return Array.from(out);
}

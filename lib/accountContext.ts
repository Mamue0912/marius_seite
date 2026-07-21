import { MailAccount } from "./mailAccounts";
import { PROVIDERS } from "./mailProviders";

// Grobe Einordnung des Kontos anhand der Domain – für den Ton der KI-Antwort.
function accountKind(email: string): string {
  const d = (email.split("@")[1] || "").toLowerCase();
  if (/(schule|schul|gymnasium|edu|uni-|\.edu|studium)/.test(d)) return "schulisch/universitär";
  if (/(icloud|me\.com|web\.de|gmx|gmail|yahoo|hotmail|outlook|live)\./.test(d + ".")) return "privat";
  return "beruflich/eigene Domain";
}

// Kurzer Kontext-Satz für die KI: welches eigene Konto, welcher Typ.
export function accountContextLine(acc: MailAccount): string {
  const label = PROVIDERS[acc.provider]?.label || acc.provider;
  const name = (acc as any).display_name && (acc as any).display_name !== acc.email ? `${(acc as any).display_name}, ` : "";
  return `Diese Nachricht kam über mein ${accountKind(acc.email)}es Konto ${name}${label} · ${acc.email}. Antworte im dazu passenden Stil und aus dieser Absenderadresse.`;
}

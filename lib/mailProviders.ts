// Voreinstellungen für die gängigen Anbieter. So muss der/die Nutzer:in nur
// E-Mail + (App-)Passwort eingeben, nicht die technischen Serverdaten.

export interface ProviderPreset {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  // Kurzer Hinweis für die UI, wie das Passwort zu beschaffen ist.
  passwordHint: string;
}

export const PROVIDERS: Record<string, ProviderPreset> = {
  icloud: {
    id: "icloud",
    label: "iCloud",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    passwordHint:
      "iCloud verlangt ein App-spezifisches Passwort: appleid.apple.com → Anmeldung & Sicherheit → App-spezifische Passwörter."
  },
  webde: {
    id: "webde",
    label: "web.de",
    imapHost: "imap.web.de",
    imapPort: 993,
    smtpHost: "smtp.web.de",
    smtpPort: 587,
    passwordHint:
      "Bei web.de zuerst IMAP aktivieren: Einstellungen → POP3/IMAP-Abruf → IMAP einschalten. Dann dein web.de-Passwort verwenden."
  }
};

export function providerPreset(id: string): ProviderPreset | null {
  return PROVIDERS[id] || null;
}

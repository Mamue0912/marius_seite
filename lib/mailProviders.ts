// Voreinstellungen gängiger Anbieter. Nutzer:innen geben in der Regel nur
// Anzeigename, E-Mail und (App-)Passwort ein. "custom" erlaubt manuelle Server.

export interface ProviderPreset {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;   // true = implizites TLS (993)
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;   // true = SSL (465), false = STARTTLS (587)
  passwordHint: string;
  custom?: boolean;
}

export const PROVIDERS: Record<string, ProviderPreset> = {
  icloud: {
    id: "icloud", label: "iCloud",
    imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true,
    smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecure: false,
    passwordHint:
      "iCloud verlangt ein App-spezifisches Passwort: appleid.apple.com → Anmeldung & Sicherheit → App-spezifische Passwörter. Das normale Apple-Passwort funktioniert nicht."
  },
  webde: {
    id: "webde", label: "WEB.DE",
    imapHost: "imap.web.de", imapPort: 993, imapSecure: true,
    smtpHost: "smtp.web.de", smtpPort: 587, smtpSecure: false,
    passwordHint:
      "WEB.DE: zuerst Einstellungen → POP3/IMAP-Abruf → IMAP aktivieren. Manche Konten benötigen ein separates App-Passwort."
  },
  gmx: {
    id: "gmx", label: "GMX",
    imapHost: "imap.gmx.net", imapPort: 993, imapSecure: true,
    smtpHost: "mail.gmx.net", smtpPort: 587, smtpSecure: false,
    passwordHint: "GMX: Einstellungen → POP3/IMAP → IMAP aktivieren. Ggf. App-Passwort nötig."
  },
  gmail: {
    id: "gmail", label: "Gmail",
    imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true,
    smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true,
    passwordHint:
      "Gmail: sicherer über OAuth (in Vorbereitung). Per IMAP brauchst du ein App-Passwort (Google-Konto → Sicherheit → 2FA → App-Passwörter). Das normale Google-Passwort funktioniert nicht."
  },
  outlook: {
    id: "outlook", label: "Outlook.com",
    imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true,
    smtpHost: "smtp-mail.outlook.com", smtpPort: 587, smtpSecure: false,
    passwordHint:
      "Outlook/Hotmail: sicherer über OAuth (in Vorbereitung). Für IMAP muss die authentifizierte SMTP/IMAP-Option im Konto aktiv sein; oft ist ein App-Passwort nötig."
  },
  hotmail: {
    id: "hotmail", label: "Hotmail",
    imapHost: "outlook.office365.com", imapPort: 993, imapSecure: true,
    smtpHost: "smtp-mail.outlook.com", smtpPort: 587, smtpSecure: false,
    passwordHint: "Hotmail nutzt dieselben Server wie Outlook.com. Meist ist ein App-Passwort nötig."
  },
  yahoo: {
    id: "yahoo", label: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecure: true,
    smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecure: true,
    passwordHint: "Yahoo verlangt ein App-Passwort (Konto-Sicherheit → App-Passwort generieren)."
  },
  custom: {
    id: "custom", label: "Anderer Anbieter (IMAP/SMTP)",
    imapHost: "", imapPort: 993, imapSecure: true,
    smtpHost: "", smtpPort: 587, smtpSecure: false,
    passwordHint: "Trage IMAP- und SMTP-Server deines Anbieters ein (z. B. Uni-/Schul- oder eigene Domain).",
    custom: true
  }
};

export function providerPreset(id: string): ProviderPreset | null {
  return PROVIDERS[id] || null;
}

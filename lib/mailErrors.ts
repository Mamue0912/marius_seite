// Übersetzt rohe IMAP/SMTP-Fehler in verständliche Hinweise.
// Gibt NIE Zugangsdaten oder vollständige technische Meldungen an die UI.
export function friendlyMailError(e: Error): string {
  const m = (e?.message || "").toLowerCase();

  if (m.includes("invalid credentials") || m.includes("authenticationfailed") || m.includes("authentication failed") || m.includes("auth") && m.includes("fail") || m.includes("535") || m.includes("login")) {
    return "Anmeldung abgelehnt. Prüfe E-Mail und (App-)Passwort. Viele Anbieter (iCloud, Gmail, Yahoo) verlangen ein App-spezifisches Passwort statt des normalen Kontopassworts.";
  }
  if (m.includes("timeout") || m.includes("timed out") || m.includes("etimedout")) {
    return "Zeitüberschreitung beim Verbinden. Prüfe Server-Adresse und Port (oder versuche es erneut).";
  }
  if (m.includes("enotfound") || m.includes("getaddrinfo") || m.includes("dns")) {
    return "Server nicht gefunden. Bitte den Servernamen (Host) prüfen.";
  }
  if (m.includes("econnrefused") || m.includes("connection refused")) {
    return "Verbindung abgelehnt. Prüfe Port und Verschlüsselung.";
  }
  if (m.includes("certificate") || m.includes("tls") || m.includes("ssl")) {
    return "TLS-/Zertifikatsproblem. Prüfe die Verschlüsselungseinstellung (SSL/STARTTLS) und den Port.";
  }
  if (m.includes("imap") && m.includes("disabled")) {
    return "IMAP ist bei diesem Konto nicht aktiviert. Bitte IMAP in den Anbieter-Einstellungen einschalten.";
  }
  return "Verbindung fehlgeschlagen. Bitte Zugangsdaten und Servereinstellungen prüfen.";
}

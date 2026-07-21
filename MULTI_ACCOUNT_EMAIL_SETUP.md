# Mehrkonten-E-Mail — Setup & Funktionsweise

Der E-Mail-Bereich des Cockpits liest und beantwortet mehrere Postfächer über
**IMAP** (Empfang) und **SMTP** (Versand). Die bisherige Outlook-/Microsoft-
Graph-Anbindung wird für private Postfächer (iCloud, web.de …) nicht benötigt.

## Unterstützte Anbieter

Vorkonfiguriert (nur E-Mail + App-/Passwort nötig):

| Anbieter | IMAP | SMTP | Passwort |
|---|---|---|---|
| iCloud | imap.mail.me.com:993 (SSL) | smtp.mail.me.com:587 (STARTTLS) | **App-spezifisches Passwort** (appleid.apple.com) |
| WEB.DE | imap.web.de:993 | smtp.web.de:587 | Passwort; IMAP muss aktiviert sein |
| GMX | imap.gmx.net:993 | mail.gmx.net:587 | Passwort; IMAP aktivieren |
| Gmail | imap.gmail.com:993 | smtp.gmail.com:465 (SSL) | **App-Passwort** (OAuth in Vorbereitung) |
| Outlook.com / Hotmail | outlook.office365.com:993 | smtp-mail.outlook.com:587 | App-Passwort (OAuth in Vorbereitung) |
| Yahoo | imap.mail.yahoo.com:993 | smtp.mail.yahoo.com:465 | **App-Passwort** |
| Anderer Anbieter | manuell | manuell | siehe „Manuelle Konfiguration" |

## Manuelle Konfiguration (eigene Domain, Uni/Schule, sonstige)

Anbieter **„Anderer Anbieter (IMAP/SMTP)"** wählen und eintragen: IMAP-Host/-Port/
SSL, SMTP-Host/-Port/SSL, E-Mail (= Benutzername), Passwort. **„Verbindung testen"**
prüft IMAP-Empfang und SMTP-Versand getrennt und meldet verständliche Fehler.

## OAuth vs. App-Passwort

- **App-Passwort/Passwort:** aktuell für alle Anbieter unterstützt. Speicherung
  serverseitig **AES-256-GCM-verschlüsselt** (`mail_accounts.password_enc`).
- **OAuth (Gmail/Outlook):** vorgesehen, aber noch nicht aktiv — erfordert je eine
  eigene App-Registrierung bei Google bzw. Microsoft. Bis dahin: App-Passwort.
- Es wird **nie** das normale Apple-/Google-/Microsoft-Kontopasswort empfohlen,
  wenn ein App-Passwort verfügbar ist.

## Weitere Konten hinzufügen

Cockpit → **„+ Postfach"** → Anbieter, optionaler Anzeigename (z. B. „Schule"),
E-Mail, Passwort → optional **Verbindung testen** → **Verbinden**. Es können
beliebig viele Konten verbunden werden.

## Verschlüsselung & Sicherheit

- Passwörter nur serverseitig, **AES-256-GCM** (Schlüssel `TOKEN_ENC_KEY`).
- Keine Zugangsdaten im Frontend, in localStorage, im Repo oder in Logs.
- Fehlermeldungen sind übersetzt und enthalten **keine** Rohfehler/Zugangsdaten
  (`lib/mailErrors.ts`).
- IMAP/SMTP ausschließlich über **TLS** (993 implizit; 587 STARTTLS erzwungen).
- Datentrennung pro Nutzer über RLS; Nachrichten sind nur für die/den Besitzer:in
  lesbar. Beim **Trennen** eines Kontos werden Zugangsdaten und dessen Nachrichten
  gelöscht.
- **Kein** automatisches Senden/Löschen/Verschieben/Weiterleiten. Versand nur nach
  ausdrücklicher Bestätigung und nur bei `ENABLE_SEND=true`.

## Ordnerzuordnung

Anbieter-Ordner werden auf einheitliche Typen abgebildet (`lib/folders.ts`), ohne
die echte Struktur zu verändern:

| Kanonisch | Beispiele |
|---|---|
| Posteingang | INBOX |
| Gesendet | Sent, Sent Messages, Gesendet |
| Entwürfe | Drafts, Entwürfe |
| Spam | Junk, Spam, Junk-E-Mail |
| Papierkorb | Trash, Deleted Messages, Papierkorb, Gelöscht |
| Archiv | Archive, Archiv |

Aktuell synchronisiert: **Posteingang** (inkrementell) und **Gesendet** (Seed je
Lauf). Weitere Ordner sind vorbereitet und folgen.

## Kontomigration

Bereits verbundene WEB.DE-/iCloud-Konten bleiben erhalten und laufen im selben
`mail_accounts`-Modell weiter. Die Erweiterungen (Anzeigename, Verschlüsselung,
Verbindungstyp) werden ergänzt; Nachrichten werden **nicht** dupliziert
(Dedupe über stabile Message-ID, `messages.graph_id`).

## Automatische Kategorien (getrennt von Ordnern)

Jede Posteingangs-Nachricht wird zusätzlich zum Ordner **inhaltlich** kategorisiert
(KI, `lib/anthropic.ts → classifyEmail`), in eine von 16 Kategorien (Wichtig,
Antwort erforderlich, Schule, Bewerbungen und Karriere, Sport und Karate, Reisen,
Termine und Veranstaltungen, Rechnungen und Finanzen, Bestellungen und Lieferungen,
Verträge und Versicherungen, Behörden, Konten und Sicherheit, Persönlich, Newsletter
und Werbung, Automatische Benachrichtigungen, Sonstiges). Getrennt davon werden
`action_status` (Sofort/Heute/… beantworten, Nur zur Information, Keine Aktion) und
`priority` gespeichert. Bei Unsicherheit → „Sonstiges" mit niedriger `confidence`.
Analysebasis: Absender/Domain, Empfängerkonto, Betreff, Vorschau (Volltext-Analyse
folgt), Anhang-Hinweis. Klassifiziert wird gedeckelt (max. 12 pro Sync), um Kosten/
Zeit zu begrenzen.

## Manuelle Sortierregeln (Nutzer-Vorrang)

Auf jeder Mailkarte (⋯) lässt sich die Kategorie ändern, der Absender/die Domain
dauerhaft einer Kategorie zuordnen oder ein Newsletter ausblenden. Regeln liegen in
`mail_rules` und haben **immer Vorrang** vor der KI. Verwaltung unter
**Einstellungen** (`/settings`): ansehen, hinzufügen, löschen.

## Antworten & Absenderkonto

Der Antwort-Assistent (drei Vorschläge + „Eigene Antwort") berücksichtigt, über
**welches eigene Konto** die Mail kam (privat/schulisch/beruflich → Ton). Das
**Absenderkonto ist vorausgewählt = Empfangskonto** und im Entwurf sichtbar/änderbar.
Versand per SMTP mit korrekten Threading-Headern (In-Reply-To/References). Es wird
zuerst ein Entwurf erstellt; **Versand nur nach Bestätigung**.

## Neue E-Mail

Cockpit → **„Neue E-Mail"**: Absenderkonto wählen, An/CC/BCC/Betreff/Text; optional
per KI-Anweisung formulieren („Schreibe meinem Trainer …"). Kein automatischer
Versand ohne Auswahl/Bestätigung.

## Datenmodell (Auszug, `messages`)

`mail_account_id`, `account_display_name`, `folder_type`, `original_folder_name`,
`from_address/name`, `to_recipients`, `cc_addresses`, `bcc_addresses`,
`reply_to_addresses`, `thread_id`, `message_id`, `in_reply_to`, `message_refs`,
`semantic_category`, `action_status`, `priority`, `classification_confidence`,
`classification_source`, `user_category_override`, `has_attachments`, `is_read`,
`is_flagged`, `is_deleted`, `received_at`, `sent_at`. Dedupe über
`unique(user_id, graph_id)` mit stabiler Message-ID.

## Tests

Struktur deckt ab: Empfang je Konto, gleiche Person an mehrere Konten (getrennte
Konto-Labels), gesendete Nachrichten, Antwort mit vorausgewähltem/änderbarem
Absenderkonto, weitere Konten (Gmail/Outlook/GMX/eigenes IMAP), Fehlerfälle
(falsche Daten/Port/fehlendes App-Passwort → verständliche Meldung), Gesendet-Ordner,
KI-Kategorie, manuelle Korrektur, Absender-/Domain-Regel, Newsletter ausblenden,
Dedupe bei erneutem Sync. **End-to-End gegen echte Postfächer wurde nicht getestet**
— dafür sind deine Zugangsdaten und erreichbare IMAP/SMTP-Server nötig; das prüfst
du live nach dem Deploy.

## Bekannte Einschränkungen

- **OAuth** (Gmail/Outlook) noch nicht aktiv → App-Passwort nötig.
- Synchronisiert werden **Posteingang + Gesendet**; Entwürfe/Spam/Papierkorb/Archiv
  sind vorbereitet, aber noch nicht befüllt.
- **Echtzeit**: auf dem Vercel-Hobby-Plan Aktualisierung beim Öffnen + 1×/Tag per
  Cron (kein IMAP-IDLE-Dauerlauf auf Serverless).
- **Anhänge**: werden erkannt (📎), aber nicht heruntergeladen/mitgesendet.
- **Thread-Ansicht**: Nachrichten tragen `thread_id`; eine zusammengefasste
  Thread-Kartenansicht folgt (aktuell Einzelkarten mit Thread-Kontext für die KI).
- Semantische Kategorisierung nutzt vorerst Betreff/Absender (Volltext-Analyse folgt),
  gedeckelt pro Sync.

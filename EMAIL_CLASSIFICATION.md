# Intelligente E-Mail-Klassifizierung

## Warum die intelligenten Ansichten vorher leer waren

Die Klassifizierung lief nur beim Sync für **neue** Mails. Bereits gespeicherte
Nachrichten (Erstsync) hatten daher keine `labels`, keine Relevanz und keinen
Handlungsbedarf – und die intelligenten Ansichten filtern genau auf diese
Felder. Ergebnis: leere/lückenhafte Ansichten.

## Was jetzt passiert

- **Deterministischer Klassifizierer** (`lib/classify2.ts`) bestimmt getrennt:
  - **Labels[]** (mehrfach): Karate, Bewerbungen, Zahlungen, Abonnements,
    Reisen, Termine, Sicherheit, Persönlich, Newsletter, Bestellungen, Schule,
    Automatisch, Sonstiges.
  - **Nachrichtentyp**: personal_direct/-thread, invoice_receipt,
    booking_change, security_alert, system_notification, welcome,
    auto_confirmation, newsletter, marketing, survey_feedback, job_offer,
    spam, unknown.
  - **Handlungsbedarf**: act_now, reply_required, action_no_reply,
    review_recommended, awaiting_reply, information_only, no_action, irrelevant.
  - **Relevanz**: sehr_wichtig, wichtig, normal, niedrig, irrelevant.
  - **needs_reply** + kurze **Zusammenfassung**.
- Er nutzt Header-Signale (List-Unsubscribe/List-ID, no-reply-Absender,
  bulk), Absender/Domain und Betreff/Text – eine Namensanrede allein macht
  eine Mail **nicht** persönlich.
- **Einmalige Nachklassifizierung**: beim Öffnen des Mailbereichs prüft der
  Client `GET /api/mail/classify`; sind Mails offen, läuft
  `POST /api/mail/classify` in Stapeln mit sichtbarem Fortschritt
  („Nachrichten werden eingeordnet: 34 von 126"). Danach wird die Liste neu
  geladen. Läuft **nicht** bei jedem Seitenaufruf – nur solange
  `classified_at` fehlt.
- **Neue Mails** werden beim Sync sofort mitklassifiziert (`imapSync.ts`).

## Beispiele (getestet gegen die Logik)

| Mail | Label | Typ | Relevanz | Handlung |
|---|---|---|---|---|
| PayPal/Apple-Beleg | Zahlungen | invoice_receipt | normal | Nur Info (kein Spam) |
| Google: unbekannter Login | Sicherheit | security_alert | sehr_wichtig | Sofort prüfen |
| Google: Passwort geändert | Sicherheit | system_notification | niedrig | Keine Aktion |
| Welcome to Supabase/GitHub | Automatisch | welcome | niedrig | Keine Aktion |
| „Wie war Ihr Erlebnis?" | Newsletter | survey_feedback | irrelevant | Keine Aktion |
| Airbnb storniert | Reisen | booking_change | wichtig | Prüfen |
| Karate-Lehrgang/Anmeldung | Karate | (personal/auto) | wichtig/normal | je nach Inhalt |

## Intelligente Ansichten (aus gespeicherten Daten)

- Wichtig → Relevanz wichtig/sehr_wichtig
- Antwort nötig → Handlungsbedarf reply_required (bzw. needs_reply)
- Persönlich → Typ personal_direct/personal_thread
- Karate/Bewerbungen/Zahlungen/Abos/Reisen → jeweiliges Label
- Newsletter → newsletter/marketing/survey_feedback
- **neu:** Sicherheit, Automatisch, Niedrige Priorität

Trash/Spam-Ordner werden in den intelligenten Ansichten ausgeblendet.

## Nutzerkorrekturen & Regeln

Im geöffneten Mail unter **„Einstufung korrigieren"**: Relevanz,
Art (Persönlich/Automatisch/Newsletter), Antwort nötig/keine Antwort, sowie
Dauerregeln: „Absender nie antwortpflichtig", „Absender immer <Label>",
„Domain → Bewerbungen". Korrekturen werden als `user_*`-Overrides gespeichert
(`classification_source = user_override`), haben **Vorrang** vor der
Automatik und bleiben bei Sync/Neu-Einordnung erhalten.

## Keine automatische Löschung

Klassifizierung ändert **nie** den Bestand. Irrelevante/automatische/niedrig
priorisierte Mails bleiben erhalten, bis du sie selbst löschst oder
archivierst.

## Nötige Datenbankfelder (`schema_classify.sql`)

`messages`: `relevance`, `summary`, `classified_at`, `user_relevance`,
`user_message_type`. `mail_rules`: `set_label`, `set_needs_reply`.
**Vor dem Deploy in Supabase ausführen** (sonst schlägt der Sync fehl, weil
die neuen Spalten fehlen).

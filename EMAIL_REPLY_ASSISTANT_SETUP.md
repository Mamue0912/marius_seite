# E-Mail-Antwort-Assistent — Setup

Intelligenter Antwort-Assistent auf Basis des Outlook-Live-Sync-Projekts:
drei kontextabhängige Vorschlags-Buttons + „Eigene Antwort", vollständige,
höfliche Entwürfe (serverseitig mit **Claude** generiert), echte Outlook-Entwürfe,
und Versand **nur nach ausdrücklicher Bestätigung**.

> Baut auf `OUTLOOK_LIVE_SYNC_SETUP.md` auf. Dieselbe Next.js/Vercel/Supabase/
> Microsoft-Graph-Struktur.

## Benötigte Microsoft-Graph-Berechtigungen

| Zweck | Scope |
|---|---|
| Thread lesen | `Mail.Read` |
| **Entwurf erstellen/aktualisieren** | `Mail.ReadWrite` |
| **Senden** (nur wenn aktiviert) | `Mail.Send` |

`Mail.Send` wird **nur** angefordert, wenn `ENABLE_SEND=true`. Ohne diese Variable
werden Entwürfe erstellt und in Outlook gespeichert, aber **nicht** gesendet.
Die Scopes werden dynamisch in `lib/env.ts → ms.scopes()` zusammengesetzt.

## KI-Konfiguration

- Läuft **serverseitig** (`lib/anthropic.ts`) über das offizielle Anthropic-SDK.
  Der Schlüssel `ANTHROPIC_API_KEY` liegt nur serverseitig, nie im Frontend.
- Modell: `ANTHROPIC_MODEL` (Standard `claude-opus-4-8`).
- **Strukturierte Ausgaben** (`output_config.format`) garantieren parsebares JSON.

### Umgebungsvariablen (zusätzlich zu OUTLOOK_LIVE_SYNC_SETUP.md)

```
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-opus-4-8
ENABLE_SEND=false        # true = Mail.Send anfordern + Senden-Knopf aktiv
```

## Datenbankänderungen

`supabase/schema_reply.sql` im SQL-Editor ausführen. Es erweitert `messages` um:
`suggested_replies` (jsonb: Label/Absicht/Erklärung/Risikohinweis), `selected_reply_intent`,
`custom_instruction`, `draft_body`, `draft_subject`, `draft_status`, `draft_language`,
`draft_tone`, `draft_binding`, `draft_needs_attachment`, `draft_missing_info`,
`outlook_draft_id`, `reply_sent_at`, `last_generated_at`.

## Ablauf & API-Routen

1. **Vorschläge** — `POST /api/reply/suggest` `{messageId}`: liest den Thread,
   erzeugt **genau drei** kurze, kontextabhängige Optionen (Label 3–5 Wörter,
   interne Absicht, Erklärung, `binding`-Flag) und cacht sie. Im Cockpit erscheinen
   sie direkt unter der Mail; der vierte Button ist **„Eigene Antwort"**.
2. **Entwurf** — `POST /api/reply/generate` `{messageId, intent|customInstruction, tone}`:
   liest den vollständigen Thread, formuliert eine komplette Antwort, erkennt Sprache,
   Tonalität, `binding`, `needs_attachment`, `missing_info`. Speichert den Entwurf
   im Cockpit **und** als **echten Outlook-Entwurf** (`createReply` + `PATCH` Body) —
   sichtbar in Outlook unter „Entwürfe". **Sendet nicht.**
3. **Verfeinern** — `POST /api/reply/refine` `{messageId, command}` (Kürzer/Freundlicher/…)
   **oder** `{messageId, editedBody}` (manuelle Bearbeitung). Ändert nur den Entwurf.
4. **Senden** — `POST /api/reply/send` `{messageId, confirm:true}`: nur wenn
   `ENABLE_SEND=true` **und** `confirm===true`. Sichert den aktuellen Text im
   Outlook-Entwurf und sendet ihn. Danach Status `gesendet`, `reply_sent_at`,
   `needs_reply=false`.

## Versandablauf / Schutz gegen versehentliches Senden

- **Nie** automatisch senden; **nie** aufgrund eines Vorschlags-Buttons senden —
  ein Klick öffnet immer nur den **bearbeitbaren Entwurf**.
- Senden nur über den expliziten **„Senden"**-Knopf und nur mit `confirm:true`.
- **Verbindliche/sensible Antworten** (`binding=true`: Jobannahme/-absage, finanzielle/
  vertragliche/rechtliche Zusagen, verbindliche Termine, sensible Infos) erfordern
  einen **zusätzlichen Bestätigungsschritt** („Verbindlich senden") und zeigen einen
  Warnhinweis.
- **Anhang-Erkennung:** verlangt der Thread Unterlagen, erscheint ein Hinweis; es
  wird nie automatisch ohne Anhänge gesendet (Anhänge fügst du in Outlook hinzu).
- Ohne `ENABLE_SEND` ist der Senden-Knopf deaktiviert; der Entwurf liegt in Outlook.
- Keine Empfänger werden ergänzt; CC/BCC bleiben unangetastet; nichts wird gelöscht/
  archiviert/verschoben/als gelesen markiert.

## KI-Prompting (Kurzfassung)

Kernregeln (in `lib/anthropic.ts`): keine Informationen erfinden; Namen/Termine/
Details exakt übernehmen; keine nicht gewählten Zusagen; nichts ergänzen; höflich,
knapp, natürlich, keine übertriebene Begeisterung; Sprache der Mail übernehmen;
Gesprächsverlauf berücksichtigen, nichts wiederholen; bei fehlenden Infos Rückfrage
statt Erfindung. Tonwahl automatisch (formell bei Firmen/Behörden/Unbekannten;
professionell-freundlich bei Bewerbungen; lockerer bei Bekannten; kurz bei kurzem Verlauf).

## Frontend

- Vorschlags-Buttons unter jeder zu beantwortenden Mail; „Eigene Antwort" neutraler.
  Responsiv (nebeneinander / gestapelt auf kleinen Displays).
- Entwurfs-Editor als hochwertiges **Drawer-Panel** (Apple-Dark): Empfänger, Betreff,
  gewählte Reaktion, erkannte Tonalität, Sprache; voll bearbeitbarer Text;
  Tonalitäts-Chips (empfohlene vorausgewählt); Schnellbefehle; Warnhinweise;
  Aktionen **Senden / Neu formulieren / Abbrechen** (Bearbeiten = inline im Textfeld).

## Werden Entwürfe direkt in Outlook gespeichert?

**Ja** — über Microsoft Graph `createReply` + `PATCH` wird ein echter Entwurf im
Postfach angelegt (sichtbar unter „Entwürfe"). Scheitert das, wird der Entwurf
vorerst nur im Cockpit gespeichert und **deutlich gekennzeichnet**.

## Getestete Fälle

Der Code deckt die geforderten Fälle strukturell ab (Jobangebot annehmen/ablehnen,
Bedenkzeit, Termin bestätigen/alternativ, Unterlagen nachreichen, informell, englische
Mail, langer Thread, fehlende Info, fehlender Anhang, Entwurf bearbeiten/neu formulieren,
Versand abbrechen, Versand nach Bestätigung, Desktop/iPad/iPhone). **End-to-End
getestet wurde nichts** — dafür sind deine Azure-/Supabase-/Vercel-Instanz, ein echtes
Postfach und ein Anthropic-API-Schlüssel nötig.

## Bekannte Einschränkungen

- Entwurf ist **Nur-Text** (kein HTML/Rich-Text); Anhänge werden nicht automatisch angehängt.
- Thread-Kontext bis 20 Nachrichten / 4000 Zeichen je Nachricht (Prompt-Grenzen).
- Die regelbasierte Erst-Kategorisierung ist konservativ; die KI-Analyse verfeinert
  Vorschläge/Entwürfe.
- Der Versand ist bewusst hinter `ENABLE_SEND` + Bestätigung gesperrt.

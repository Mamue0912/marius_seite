# KI-Antwort – Fehlerbehebung & Architektur (Phase 2)

Dieses Dokument erklärt, wie die KI-Antwortfunktion aufgebaut ist, welche
Ursachen das frühere „lädt ewig / kein Ergebnis / kein verständlicher Fehler"
hatte und wie man Probleme diagnostiziert.

## Symptome vorher

- Antwortgenerierung lud sehr lange oder blieb im Ladezustand hängen.
- Kein brauchbares Ergebnis, kein verständlicher Fehler.
- Unklar, ob die Anfrage überhaupt im Backend ankam.

## Gefundene Ursachen

1. **Fehlender API-Schlüssel.** `env.anthropicKey()` wirft, wenn
   `ANTHROPIC_API_KEY` nicht gesetzt ist. Der Client zeigte nur „Fehler".
2. **Kein Zeitlimit / kein Abbruch.** Weder Client noch Server hatten ein
   Timeout. Bei langsamer IMAP-/KI-Antwort drehte der Spinner endlos.
3. **Fehlerzustand ohne Entwurf.** Trat beim ersten Generieren ein Fehler
   auf, blieb das Draft-Panel im Dauerspinner (kein Entwurf + `loading:false`).
4. **Vorschläge-Spinner** ohne „fertig"-Zustand: bei leerem/fehlgeschlagenem
   Abruf drehte er dauerhaft.

## Architektur jetzt

- **Nur serverseitig.** API-Schlüssel liegt ausschließlich in
  `ANTHROPIC_API_KEY` (Vercel). Niemals im Frontend/localStorage.
- **Zentrale Route:** `POST /api/mail/generate-reply`.
  - Body: `{ messageId, intent?, intentLabel?, customInstruction?, tone?, length? }`.
  - Der **Server lädt selbst** Nachricht, Absender, Empfänger, Betreff,
    Thread und Konto (`buildThreadContext`). Dem Frontend wird **kein**
    vollständiger Mailinhalt anvertraut.
  - Prüft zuerst `aiConfigured()` → bei fehlendem Schlüssel sofort **503**
    „Die KI-Verbindung ist noch nicht vollständig eingerichtet.".
- **Serverseitiges Zeitlimit:** KI-Aufrufe (`lib/anthropic.ts` → `parseJson`)
  laufen mit `timeout: 38 s` und `maxRetries: 1`. Route `maxDuration = 45`.
- **Verständliche Fehler:** `aiErrorInfo(e)` bildet Fehler auf Kategorien ab:
  `not_configured` / `auth` / `rate_limit` / `overloaded` / `timeout` /
  `api_error` – jeweils mit deutschem Klartext, ohne Schlüssel/Inhalte.
- **Client-seitig** (`components/Cockpit.tsx` → `fetchJson`):
  - Harter **AbortController + 45-s-Timeout** für Generieren, Verfeinern,
    Vorschläge und Senden.
  - **„Abbrechen"-Button** während der Generierung (custom & normal).
  - Nach Fehler/Abbruch **verlässt** die UI den Ladezustand immer und zeigt
    eine verständliche Meldung + „Erneut versuchen" / „KI-Diagnose".
  - Kein unendlicher Spinner mehr – max. ~45 s bis Erfolg/Abbruch/Fehler.

## Kontextabhängige Aktionen

- **Persönliche / antwortrelevante Mails:** drei KI-Vorschläge + „Eigene
  Antwort".
- **PayPal / Newsletter / Umfrage / System:** stattdessen Aktionen
  (Archivieren / Keine Aktion / Newsletter ausblenden / „Doch Antwort nötig")
  **plus** „Trotzdem mit KI antworten".

## Entwurfseditor

Von (Konto, wählbar) · An · Betreff · Reaktion · Tonalität · bearbeitbarer
Text. Schnelle Bearbeitung (Kürzer/Freundlicher/Förmlicher/Direkter/Wärmer/
Weniger begeistert/Mehr Kontext/Rechtschreibung) mit eigenem Lade- und
Fehlerzustand (`refining` / `refineError`).

## Senden

Nie automatisch. Erst nach ausdrücklichem **Senden** (bei verbindlichen
Antworten zusätzlicher Bestätigungsschritt), nur wenn `ENABLE_SEND=true`.
Nach SMTP-Erfolg → Status **„Gesendet"** + `reply_sent_at`.

## Owner-Diagnose

- Button **„Diagnose" / „KI-Diagnose"** im Antwortbereich und im Fehlerfall.
- `GET /api/mail/ai-diagnostics` liefert: `configured`, `model`,
  `sendEnabled` und die letzten 20 Ereignisse (Zeit, Erfolg, Dauer,
  Fehlerkategorie). **Keine** Schlüssel, **keine** Mailinhalte.
- Persistenz optional über Tabelle `ai_events` (`schema_ai.sql`). Fehlt die
  Tabelle, funktioniert die KI trotzdem – nur die Historie bleibt leer.

## Checkliste bei Problemen

1. **Diagnose öffnen** → „KI-Verbindung: nicht eingerichtet"? → in Vercel
   `ANTHROPIC_API_KEY` setzen und **neu deployen**.
2. Fehlerkategorie `auth` → Schlüssel ungültig. `rate_limit`/`overloaded` →
   kurz warten. `timeout` → erneut versuchen.
3. Historie leer, obwohl Anfragen liefen → `schema_ai.sql` in Supabase
   ausführen.
4. Senden schlägt fehl → `ENABLE_SEND=true`? SMTP-App-Passwort korrekt?
   (Meldung stammt aus `friendlyMailError`.)

## Benötigte Vercel-Umgebungsvariablen

- `ANTHROPIC_API_KEY` (Pflicht für KI)
- `ANTHROPIC_MODEL` (optional, Standard `claude-opus-4-8`)
- `ENABLE_SEND=true` (nur wenn wirklich gesendet werden soll)

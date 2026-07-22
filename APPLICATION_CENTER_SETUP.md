# Bewerbungszentrale + KI-Service – Einrichtung

Die Bewerbungszentrale ist ein eigenes Sub-Cockpit unter **/applications**
(Navigation „Bewerbungen"). Sie nutzt die bestehende Architektur
(Next.js + Vercel + Supabase) und den gemeinsamen serverseitigen KI-Service.

## 1. Datenbank (einmalig in Supabase ausführen)

SQL-Editor öffnen und nacheinander ausführen:

1. `schema_ai.sql` – KI-Diagnose (optional, aber empfohlen).
2. `schema_applications.sql` – Bewerbungen, Unterlagen, Fakten, Chat,
   erstellte Dokumente **und** der private Storage-Bucket `documents`.

Der letzte Befehl in `schema_applications.sql` legt den Bucket **privat** an.
Falls das per SQL nicht durchläuft: Storage → New bucket → Name `documents`
→ **nicht** public. (Die App legt ihn beim ersten Upload sonst selbst an.)

## 2. Umgebungsvariablen (Vercel)

| Variable | Zweck | Pflicht |
|---|---|---|
| `ANTHROPIC_API_KEY` | KI-Service (Mail, Stellenanalyse, Chat, Dokumente) | **ja** für KI |
| `ANTHROPIC_MODEL` | Modell (Standard `claude-opus-4-8`) | nein |
| `ENABLE_SEND` | erlaubt tatsächlichen Mailversand (`true`) | nur zum Senden |
| `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Storage/DB serverseitig | ja (bereits gesetzt) |

Nach dem Setzen von Variablen **neu deployen**.

## 3. Was die Bewerbungszentrale kann

- **Übersicht** mit gestaffelten Modulen: aktive Bewerbungen, offene Fristen,
  in Vorbereitung, wartend, nächste Handlung, zuletzt bearbeitet.
- **Neue Stelle**: Link einfügen → Seite wird geladen und analysiert.
  Fallbacks, falls der Link technisch nicht lesbar ist: **Text einfügen**,
  **PDF/Screenshot** (Screenshot per Bilderkennung), **E-Mail übernehmen**
  (im Mailbereich Button „Als Stelle übernehmen").
- **Analyse** (ohne Prozentzahlen): Art (Praktikum/Nebenjob/Ausbildung/Stelle),
  Unternehmen, Position, Aufgaben, zwingende vs. wünschenswerte Anforderungen,
  verlangte Unterlagen, Frist, Ansprechpartner, Hinweise sowie
  **starke / teilweise Übereinstimmung / offene Punkte** anhand deiner
  bestätigten Fakten.
- **Arbeitsbereich je Bewerbung** (Desktop: Stelle links, Chat mittig,
  Dokumente/Entwurf rechts): Status, zugeordnete E-Mails/Unterlagen, Aufgaben,
  erstellte Dokumente, durchgehender Chat.
- **Bewerbungs-Chat**: kennt Stelle + bestätigte Unterlagen + bisherige
  Entwürfe; Kontext geht nicht verloren. Fehlt etwas, fragt die KI nach.
- **Meine Unterlagen**: privater Upload (PDF/DOCX/TXT/Bilder), Vorschau,
  Verarbeitungsstatus, Freigabe „für Bewerbungen", Umbenennen/Ersetzen/Löschen,
  Zuordnung zu Bewerbungen.
- **Fakten aus Unterlagen**: die KI erkennt belegbare Fakten → du
  **bestätigst / korrigierst / löschst / ergänzt**. Nur bestätigte Fakten
  werden in Bewerbungen verwendet. Es werden keine Angaben erfunden.
- **Dokumente erstellen** (echte DOCX): Anschreiben, Motivationsschreiben,
  Bewerbungsmail, Kurzprofil, Gesprächsvorbereitung – mit Tonwahl, im Cockpit
  bearbeitbar, kurze Anpassungen (kürzer/persönlicher/…), DOCX-Download.
- **Bewerbungsmail**: nie automatisch. Vor dem Versand sichtbar: Von, An, CC,
  Betreff, Text, Anhänge. Warnung, wenn verlangte Unterlagen fehlen. Versand
  erst nach ausdrücklichem Klick und nur bei `ENABLE_SEND=true`.

## 4. Sicherheit

- Private Dokumente im nicht-öffentlichen Bucket, Zugriff nur über
  kurzlebige Signed-URLs. Keine öffentlichen Datei-Links.
- Row Level Security auf allen neuen Tabellen (nur Eigentümer).
- KI-Schlüssel bleibt serverseitig. Keine Schlüssel/Inhalte in Logs oder
  in der Diagnose.
- Keine automatische Bewerbung, kein automatisches Senden, keine erfundenen
  Angaben.

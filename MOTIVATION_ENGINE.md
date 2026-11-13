# Motivationsschreiben-Engine

Eine WHU-spezifische, aber modular aufgebaute Schreib-Engine. Sie erzeugt
keinen beliebigen KI-Text, sondern arbeitet gegen eine geprüfte Faktenlage.

## Leitgedanke

Jede Tatsachenbehauptung im fertigen Text muss sich auf einen Datensatz in
der Evidence Database zurückführen lassen. Was dort nicht steht, darf nicht
im Text stehen. Was dort als *geplant* steht, darf nie als Erfahrung
erscheinen.

## Aufbau

| Datei | Zweck |
|---|---|
| `lib/admissions/types.ts` | Schnittstelle eines Admissions-Profils |
| `lib/admissions/whu.ts` | WHU-Profil: Vorgaben, Werte, Curriculum, Quellen |
| `lib/admissions/index.ts` | Registrierung weiterer Hochschulen |
| `lib/evidence.ts` | Evidence Database: Status, Tiefe, Auswahl, Widersprüche |
| `lib/prompts.ts` | Versionierte Prompts, Datenkapselung, Tonalität |
| `lib/qualityRubric.ts` | 10-Dimensionen-Rubrik, Compliance, Stilprüfung |
| `lib/motivationPdf.ts` | PDF-Satz mit echter Seitenzählung |
| `lib/motivationContext.ts` | Serverseitige Datenzugriffe |

### Weitere Hochschule ergänzen

Ein Profil nach `AdmissionsProfile` anlegen und in `lib/admissions/index.ts`
registrieren. Pipeline, Prüfung und Oberfläche bleiben unverändert.

## Faktenstatus

| Status | Bedeutung | Im Text |
|---|---|---|
| `CONFIRMED` | durch Unterlage belegt | als Tatsache |
| `USER_REPORTED` | selbst berichtet | als Tatsache |
| `PLANNED` | steht noch bevor | **nur** als Vorhaben |
| `INFERRED` | nur erschlossen | **gar nicht** |
| `UNKNOWN` | nicht bekannt | **gar nicht** |

Durchgesetzt an drei Stellen: im Prompt (`evidenceBlock` markiert jeden
Eintrag), im Faktencheck (Abgleich Satz für Satz) und in der
deterministischen Compliance-Prüfung (`complianceChecks`).

## Pipeline

| Stufe | Wo | Aufruf |
|---|---|---|
| A Evidence | `loadEvidence`, `loadSourceMaterial` | ohne Modell |
| B–D Motive, Auswahl, Argumentation | `planMotivationNarrative` | 1 |
| E Entwurf | `writeMotivationDraft` | 1 |
| F Kritischer Review | `reviewMotivationDraft` | 1, eigene Rolle |
| G Revision | `reviseWeakParagraphs` | 1, nur schwache Absätze |
| H Faktencheck | `factCheckMotivation` | 1, eigener Aufruf |
| I Interviewfestigkeit | `interviewReadiness` | 1 |

Prüfstufen laufen getrennt von der Erzeugung, damit das Modell nicht im
selben Durchgang seine eigene Arbeit bewertet. Die Vorauswahl der
Geschichten (`selectStories`) ist deterministisch und bevorzugt Tiefe und
argumentative Vielfalt, nicht Prestige.

## Schutz vor Prompt Injection

Importierte Unterlagen werden über `dataBlock()` gekapselt: als Material
deklariert, Rollenmarker und Abschnittsgrenzen entschärft, Länge begrenzt.
Eine Anweisung im Lebenslauf bleibt damit Text, keine Instruktion.

## Qualitätsrubrik

Zehn Dimensionen mit je 0–10 Punkten, dazu harte Compliance-Prüfungen.

**Die Punktwerte sind eine redaktionelle Selbsteinschätzung dieser
Anwendung.** Sie sind keine offizielle Bewertung der Hochschule und sagen
nichts über die Zulassungschance aus. Das steht auch in der Oberfläche.

## Datenbank

`schema_motivation.sql`, danach `schema_evidence.sql` ausführen. Beide sind
gefahrlos erneut ausführbar. Alle Tabellen mit RLS-Eigentümer-Policy.

## Modelle

Zentral in `lib/aiModels.ts`, per `ANTHROPIC_MODEL`, `ANTHROPIC_MODEL_WRITING`
und `ANTHROPIC_MODEL_FAST` übersteuerbar. Denk-Token zählen gegen
`max_tokens`, deshalb rechnet `totalTokens()` einen Puffer hinzu.

## Grenzen

- Die Punktwerte sind nicht validiert und keine Vorhersage.
- Die Engine kann nur prüfen, was in der Evidence Database steht. Ein
  falscher Status dort führt zu einem falschen Ergebnis hier.
- UCAS-Leitfäden zum Personal Statement konnten nicht eingearbeitet werden:
  die Domain ist in der Entwicklungsumgebung nicht erreichbar.

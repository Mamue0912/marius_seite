import test from "node:test";
import assert from "node:assert/strict";
import {
  countWords, countChars, paragraphs, checkRequirements, qualityFindings,
  openQuestions, missingProfileFields, defaultOutline, profileBlock, examplesBlock,
  QUESTION_GROUPS, type PersonalProfile, type PersonalExample
} from "../lib/motivation";
import { whuFileName, bindingRequirements, WHU_REQUIREMENTS, WHU_SOURCES, WHU_NOT_SPECIFIED } from "../lib/whuRequirements";
import { buildMotivationPdf, toWinAnsi } from "../lib/motivationPdf";
import { modelFor, MODEL_CATALOG } from "../lib/aiModels";

const profile: PersonalProfile = {
  firstName: "Marius", lastName: "Müller", birthDate: "2008-09-12",
  school: "Kaiser-Friedrich-Ufer-Gymnasium", goals: "Unternehmensführung"
};

// ---------------------------------------------------------------- Zähler
test("Zähler erfassen Wörter, Zeichen und Absätze", () => {
  const t = "Erster Absatz hier.\n\nZweiter   Absatz mit  mehreren Leerzeichen.";
  assert.equal(countWords(t), 8);
  assert.equal(countChars(t), t.length);
  assert.equal(paragraphs(t).length, 2);
  assert.equal(countWords("   "), 0);
});

// ------------------------------------------------- Verbindliche Vorgaben
test("Fehlende Pflichtangaben werden erkannt", () => {
  const res = checkRequirements({ body: "Ich möchte gern studieren.", profile, language: "de", renderedPages: 1 });
  const by = (id: string) => res.find((r) => r.id === id)!;
  assert.equal(by("identity_line").status, "fehlt");
  assert.equal(by("motivation_whu").status, "fehlt");
  assert.equal(by("self_description").status, "fehlt");
});

test("Vollständiges Schreiben erfüllt die prüfbaren Vorgaben", () => {
  const body = [
    "Marius Müller, geboren am 12.09.2008.",
    "Ich bewerbe mich für Internationale BWL, weil mich Unternehmensführung beschäftigt.",
    "Die WHU passt zu mir, weil die Lehre englischsprachig ist.",
    "Meine Stärke ist Ausdauer, meine Schwäche Ungeduld; mein Ziel ist Unternehmensführung."
  ].join("\n\n");
  const res = checkRequirements({ body, profile, language: "de", renderedPages: 2 });
  for (const id of ["identity_line", "no_photo_no_contact", "motivation_subject", "motivation_whu", "self_description", "file_name", "max_two_pages"]) {
    assert.equal(res.find((r) => r.id === id)!.status, "ok", `${id} sollte erfüllt sein`);
  }
});

test("Kontaktdaten im Text werden beanstandet", () => {
  const withMail = checkRequirements({ body: "Marius Müller, 12.09.2008. Mail: m@example.com", profile, language: "de", renderedPages: 1 });
  assert.equal(withMail.find((r) => r.id === "no_photo_no_contact")!.status, "fehlt");

  const withPhone = checkRequirements({ body: "Marius Müller, 12.09.2008. Tel: +49 170 1234567", profile, language: "de", renderedPages: 1 });
  assert.equal(withPhone.find((r) => r.id === "no_photo_no_contact")!.status, "fehlt");

  const withStreet = checkRequirements({ body: "Marius Müller, 12.09.2008. Musterstraße 12, 20255 Hamburg", profile, language: "de", renderedPages: 1 });
  assert.equal(withStreet.find((r) => r.id === "no_photo_no_contact")!.status, "fehlt");
});

test("Seitenregel: unbekannte Seitenzahl ist manuell, drei Seiten sind ein Fehler", () => {
  const unknown = checkRequirements({ body: "Text", profile, language: "de", renderedPages: null });
  assert.equal(unknown.find((r) => r.id === "max_two_pages")!.status, "manuell");
  const tooLong = checkRequirements({ body: "Text", profile, language: "de", renderedPages: 3 });
  assert.equal(tooLong.find((r) => r.id === "max_two_pages")!.status, "fehlt");
});

test("Sprache der Auswahlrunde bleibt eine manuelle Entscheidung", () => {
  const res = checkRequirements({ body: "Text", profile, language: "de", renderedPages: 1 });
  assert.equal(res.find((r) => r.id === "language_matches_round")!.status, "manuell");
});

// -------------------------------------------------- Geplant vs. erledigt
test("Geplantes Praktikum darf nicht als abgeschlossen klingen", () => {
  const findings = qualityFindings({
    body: "Während meines Praktikums bei Punica Invest habe ich Analysen erstellt.",
    examples: [],
    plannedTerms: ["Punica Invest"]
  });
  assert.ok(findings.some((f) => f.area === "unbelegt"), "Geplantes muss als Problem auffallen");
});

test("Korrekt als Vorhaben formuliert erzeugt keinen Fehlalarm", () => {
  const findings = qualityFindings({
    body: "Für Februar 2027 ist ein Praktikum bei Punica Invest vorgesehen.",
    examples: [],
    plannedTerms: ["Punica Invest"]
  });
  assert.ok(!findings.some((f) => f.area === "unbelegt"));
});

test("Floskeln und Wiederholungen werden gemeldet", () => {
  const findings = qualityFindings({ body: "Ich war schon immer an der renommiert wirkenden Hochschule interessiert.", examples: [], plannedTerms: [] });
  assert.ok(findings.some((f) => f.area === "stil"));
});

test("Fehlender WHU-Bezug wird als wichtig gemeldet", () => {
  const findings = qualityFindings({ body: "Ich interessiere mich für Zahlen.", examples: [], plannedTerms: [] });
  const hit = findings.find((f) => f.area === "whu_bezug");
  assert.ok(hit && hit.severity === "wichtig");
});

test("Qualitätsprüfung liefert nie eine Bewertung der Zulassungschance", () => {
  const findings = qualityFindings({ body: "Irgendein Text.", examples: [], plannedTerms: [] });
  const text = JSON.stringify(findings).toLowerCase();
  for (const forbidden of ["wahrscheinlichkeit", "chance", "prozent", "punktzahl", "note "]) {
    assert.ok(!text.includes(forbidden), `"${forbidden}" darf nicht vorkommen`);
  }
});

// ----------------------------------------------------------- Rückfragen
test("Beantwortete Fragen werden nicht erneut gestellt", () => {
  const answered: PersonalExample[] = [{ questionKey: "entscheidung_projekt", question: "x", situation: "Preis gesenkt" }];
  const open = openQuestions(answered);
  const keys = open.flatMap((g) => g.questions.map((q) => q.key));
  assert.ok(!keys.includes("entscheidung_projekt"));
  assert.ok(keys.length > 0, "andere Fragen bleiben offen");
});

test("Leere Antworten gelten nicht als beantwortet", () => {
  const open = openQuestions([{ questionKey: "entscheidung_projekt", question: "x", situation: "   " }]);
  const keys = open.flatMap((g) => g.questions.map((q) => q.key));
  assert.ok(keys.includes("entscheidung_projekt"));
});

test("Alle Fragen beantwortet ergibt keine offenen Gruppen", () => {
  const all = QUESTION_GROUPS.flatMap((g) => g.questions).map((q) => ({ questionKey: q.key, question: q.question, situation: "x" }));
  assert.equal(openQuestions(all).length, 0);
});

// ------------------------------------------------------------- Profil
test("Fehlende Profilfelder werden benannt", () => {
  assert.deepEqual(missingProfileFields({}), ["Vorname", "Nachname", "Geburtsdatum", "Schule", "Berufliche Ziele"]);
  assert.deepEqual(missingProfileFields(profile), []);
});

test("Geplantes wird im Prompt getrennt und markiert", () => {
  const block = profileBlock({ ...profile, planned: "Praktikum Punica Invest ab Februar 2027" });
  assert.ok(block.includes("NUR GEPLANT"));
  assert.ok(block.includes("Punica Invest"));
});

test("Beispiele markieren geplante Vorhaben im Prompt", () => {
  const block = examplesBlock([{ questionKey: "k", question: "F", situation: "S", isPlanned: true }]);
  assert.ok(block.includes("GEPLANTES Vorhaben"));
});

// ------------------------------------------------------------ Dateiname
test("Dateiname folgt dem WHU-Muster und behandelt Umlaute", () => {
  assert.equal(whuFileName("Müller", "Marius", "pdf"), "Mueller_Marius_LM.pdf");
  assert.equal(whuFileName("Mustermann", "Erika", "docx"), "Mustermann_Erika_LM.docx");
  assert.equal(whuFileName("", "", "pdf"), "Nachname_Vorname_LM.pdf");
  assert.equal(whuFileName("Groß Schmidt", "Anna-Lena", "pdf"), "Gross-Schmidt_Anna-Lena_LM.pdf");
});

// ------------------------------------------------------- Anforderungsdaten
test("Jede verbindliche Vorgabe hat mindestens eine Quelle", () => {
  for (const r of bindingRequirements()) {
    assert.ok(r.sourceIds.length > 0, `${r.id} braucht eine Quelle`);
    for (const id of r.sourceIds) {
      assert.ok(WHU_SOURCES.some((s) => s.id === id), `unbekannte Quelle ${id}`);
    }
  }
});

test("Eigene Empfehlungen werden nicht als Hochschulvorgabe ausgegeben", () => {
  for (const r of WHU_REQUIREMENTS.filter((x) => x.kind === "own")) {
    assert.equal(r.sourceIds.length, 0, `${r.id} darf keine Hochschulquelle führen`);
  }
});

test("Keine erfundene Wortgrenze oder Schriftvorgabe", () => {
  const text = JSON.stringify(WHU_REQUIREMENTS).toLowerCase();
  assert.ok(!/\b\d{3,4}\s*(wörter|woerter|words)\b/.test(text), "keine Wortgrenze erfinden");
  assert.ok(WHU_NOT_SPECIFIED.some((n) => n.topic === "Wortanzahl"));
  assert.ok(WHU_NOT_SPECIFIED.some((n) => n.topic.startsWith("Schriftart")));
});

test("Jede Quelle hat URL und Abrufdatum", () => {
  for (const s of WHU_SOURCES) {
    assert.match(s.url, /^https:\/\/www\.whu\.edu\//);
    assert.match(s.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});

// --------------------------------------------------------------- PDF
test("PDF: kurzer Text ergibt genau eine Seite", async () => {
  const r = await buildMotivationPdf({ body: "Kurzer Text.", headerLines: ["Marius Müller"] });
  assert.equal(r.pages, 1);
  assert.equal(r.fits, true);
});

test("PDF: Seitenzahl kommt aus dem Satz, nicht aus der Wortzahl", async () => {
  const long = Array.from({ length: 70 }, (_, i) =>
    `Absatz ${i + 1}: Ein ausführlicher Abschnitt über Betriebswirtschaft und Verantwortung, der mehrere Zeilen belegt.`
  ).join("\n\n");
  const r = await buildMotivationPdf({ body: long, maxPages: 2 });
  assert.ok(r.pages > 2, "zu langer Text muss mehr als zwei Seiten ergeben");
  assert.equal(r.fits, false, "und ehrlich als nicht passend gemeldet werden");
});

test("PDF: Schrift wird nie unter die Lesbarkeitsgrenze verkleinert", async () => {
  const long = Array.from({ length: 200 }, () => "Sehr langer Fülltext für die Seitenprüfung.").join("\n\n");
  const r = await buildMotivationPdf({ body: long, maxPages: 2, minFontSize: 10 });
  assert.ok(r.fontSize >= 10, `Schriftgröße ${r.fontSize} unterschreitet die Grenze`);
  assert.equal(r.fits, false);
});

test("PDF: Umlaute bleiben erhalten, Sonderzeichen werden ersetzt", () => {
  assert.equal(toWinAnsi("Müller Größe Übung ß"), "Müller Größe Übung ß");
  assert.equal(toWinAnsi("Gedanken– „zitiert“ …"), 'Gedanken- "zitiert" ...');
  assert.equal(toWinAnsi("Emoji 😀 weg"), "Emoji  weg");
});

test("PDF erzeugt eine gültige PDF-Datei", async () => {
  const r = await buildMotivationPdf({ body: "Test mit Umlauten: Müller, Größe." });
  const head = Buffer.from(r.bytes.slice(0, 5)).toString("latin1");
  assert.equal(head, "%PDF-");
});

// ------------------------------------------------------------- Modelle
test("Modellauswahl ist zentral und per Umgebungsvariable übersteuerbar", () => {
  const before = process.env.ANTHROPIC_MODEL_WRITING;
  delete process.env.ANTHROPIC_MODEL_WRITING;
  delete process.env.ANTHROPIC_MODEL;
  assert.equal(modelFor("writing"), "claude-opus-5-5");
  assert.equal(modelFor("fast"), "claude-haiku-5-5");
  process.env.ANTHROPIC_MODEL_WRITING = "claude-sonnet-5-5";
  assert.equal(modelFor("writing"), "claude-sonnet-5-5");
  if (before === undefined) delete process.env.ANTHROPIC_MODEL_WRITING;
  else process.env.ANTHROPIC_MODEL_WRITING = before;
});

test("Standardmodelle stehen im geprüften Katalog", () => {
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL_WRITING;
  delete process.env.ANTHROPIC_MODEL_FAST;
  for (const purpose of ["standard", "writing", "fast"] as const) {
    assert.ok(MODEL_CATALOG[modelFor(purpose)], `${purpose} nutzt ein unbekanntes Modell`);
  }
});

// ----------------------------------------------------------- Gliederung
test("Standardgliederung deckt die Pflichtbestandteile ab", () => {
  const de = defaultOutline("de");
  const ids = de.map((s) => s.id);
  assert.ok(ids.includes("subject") && ids.includes("whu") && ids.includes("self"));
  assert.equal(defaultOutline("en").length, de.length);
});

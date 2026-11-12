// =====================================================================
//  Anforderungen an das Motivationsschreiben – WHU Bachelor
//
//  Diese Datei ist die EINZIGE Quelle der Wahrheit für Hochschulvorgaben.
//  Sie ist bewusst als Daten (nicht als Prompt-Text) gehalten, damit sie
//  aktualisierbar und prüfbar bleibt.
//
//  Strenge Trennung:
//    kind: "binding" → verbindliche Vorgabe der Hochschule (mit Quelle)
//    kind: "tip"     → unverbindlicher Hinweis der Hochschule (mit Quelle)
//    kind: "own"     → eigene Empfehlung dieser Anwendung (KEINE WHU-Vorgabe)
//
//  Erfundene Vorgaben sind ausdrücklich unzulässig. Was die Hochschule
//  nicht vorgibt (z. B. Wortgrenze, Schriftart), ist unten als
//  NOT_SPECIFIED dokumentiert und darf nirgends als Vorgabe erscheinen.
// =====================================================================

export type RequirementKind = "binding" | "tip" | "own";

export interface RequirementSource {
  id: string;
  title: string;
  url: string;
  retrievedAt: string; // ISO-Datum des Abrufs
}

export interface Requirement {
  id: string;
  kind: RequirementKind;
  /** Kurztext für die Checkliste. */
  label: string;
  /** Ausführlichere Erläuterung, optional. */
  detail?: string;
  /** IDs aus SOURCES. Bei kind "own" leer. */
  sourceIds: string[];
  /** Kann die Anwendung das automatisch prüfen? */
  checkable: boolean;
}

export interface Programme {
  id: string;
  institution: string;
  programme: string;
  degree: string;
  /** Voraussichtlicher Studienstart. */
  intake: string;
  languages: ("de" | "en")[];
}

// ---------------------------------------------------------------------
// Quellen
// ---------------------------------------------------------------------
export const WHU_SOURCES: RequirementSource[] = [
  {
    id: "whu_docs_de",
    title: "WHU – Bewerbungsunterlagen Bachelor (PDF, DE)",
    url: "https://www.whu.edu/fileadmin/CONTENT/whu.edu/1_Programs/1.1_Bachelor_Program/PDF/Bewerbungsunterlagen_DE_2026.pdf",
    retrievedAt: "2026-11-11"
  },
  {
    id: "whu_docs_en",
    title: "WHU – Application Documents Bachelor (PDF, EN)",
    url: "https://www.whu.edu/fileadmin/CONTENT/whu.edu/1_Programs/1.1_Bachelor_Program/PDF/Application_Documents_EN_2026.pdf",
    retrievedAt: "2026-11-11"
  },
  {
    id: "whu_apply_de",
    title: "WHU – Bachelor in Internationaler BWL/Management: Bewerbung und Zulassung",
    url: "https://www.whu.edu/de/programme/bachelor-programm/bachelor-in-internationaler-betriebswirtschaft/bewerbung-zulassung/",
    retrievedAt: "2026-11-11"
  },
  {
    id: "whu_apply_en",
    title: "WHU – Bachelor in International Business Administration: Application & Admissions",
    url: "https://www.whu.edu/en/programs/bachelor-program/bachelor-in-international-business-administration/application-admissions/",
    retrievedAt: "2026-11-11"
  },
  {
    id: "whu_tips",
    title: "WHU-Magazin – Fünf Tipps für die Bachelor-Bewerbung",
    url: "https://www.whu.edu/de/news-insights/whu-magazin/artikel/fuenf-tipps-fuer-die-bachelor-bewerbung-an-der-whu-otto-beisheim-school-of-management/",
    retrievedAt: "2026-11-11"
  }
];

export const WHU_BACHELOR: Programme = {
  id: "whu-bsc-iba",
  institution: "WHU – Otto Beisheim School of Management",
  programme: "Bachelor in Internationaler BWL/Management (BSc International Business Administration)",
  degree: "Bachelor of Science",
  intake: "01.09.2027",
  languages: ["de", "en"]
};

// ---------------------------------------------------------------------
// Verbindliche Vorgaben + Tipps + eigene Empfehlungen
// ---------------------------------------------------------------------
export const WHU_REQUIREMENTS: Requirement[] = [
  {
    id: "max_two_pages",
    kind: "binding",
    label: "Maximal 2 Seiten DIN A4",
    detail: "Umfang: maximal 2 Seiten DIN A4. Wird beim PDF-Export anhand der tatsächlich gesetzten Seiten geprüft, nicht anhand der Wortzahl.",
    sourceIds: ["whu_docs_de", "whu_docs_en"],
    checkable: true
  },
  {
    id: "identity_line",
    kind: "binding",
    label: "Name, Vorname und Geburtsdatum angeben",
    detail: "Das Schreiben muss Name, Vorname und Geburtsdatum enthalten.",
    sourceIds: ["whu_docs_de", "whu_docs_en"],
    checkable: true
  },
  {
    id: "no_photo_no_contact",
    kind: "binding",
    label: "Kein Foto, keine weiteren Kontaktdaten",
    detail: "Ausdrücklich ohne Foto und ohne weitere persönliche Kontaktdaten (also keine Anschrift, Telefonnummer oder E-Mail-Adresse).",
    sourceIds: ["whu_docs_de", "whu_docs_en"],
    checkable: true
  },
  {
    id: "motivation_subject",
    kind: "binding",
    label: "Motivation für das Studienfach",
    detail: "Motivation für das Studienfach Internationale BWL/Management.",
    sourceIds: ["whu_docs_de", "whu_docs_en"],
    checkable: true
  },
  {
    id: "motivation_whu",
    kind: "binding",
    label: "Motivation für die WHU",
    detail: "Motivation für die WHU – Otto Beisheim School of Management.",
    sourceIds: ["whu_docs_de", "whu_docs_en"],
    checkable: true
  },
  {
    id: "self_description",
    kind: "binding",
    label: "Selbstbeschreibung",
    detail: "Selbstbeschreibung, zum Beispiel Stärken, Schwächen, Eignung für die WHU und berufliche Ziele.",
    sourceIds: ["whu_docs_de", "whu_docs_en"],
    checkable: true
  },
  {
    id: "file_name",
    kind: "binding",
    label: "Dateiname: Nachname_Vorname_LM",
    detail:
      "Das offizielle Unterlagen-PDF gibt das Muster „Mustermann_Erika_LM“ vor (ohne Dateiendung). Der WHU-Magazin-Artikel nennt dasselbe Muster mit Endung: Nachname_Vorname_LM.pdf.",
    sourceIds: ["whu_docs_de", "whu_docs_en", "whu_tips"],
    checkable: true
  },
  {
    id: "language_matches_round",
    kind: "binding",
    label: "Sprache = Sprache der Endauswahlrunde",
    detail:
      "Lebenslauf und Motivationsschreiben auf Deutsch, wenn die Endauswahlrunde auf Deutsch absolviert wird – auf Englisch, wenn die Endauswahlrunde auf Englisch bevorzugt wird. Die Sprachwahl beeinflusst die Chancen nicht.",
    sourceIds: ["whu_docs_de", "whu_docs_en"],
    checkable: false
  },
  {
    id: "tip_authentic",
    kind: "tip",
    label: "Ehrlich und authentisch schreiben",
    detail:
      "Das Schreiben sollte authentisch sein und deutlich machen, warum die Bewerberin oder der Bewerber gut zur WHU passt; darstellen, warum man an der WHU studieren möchte und welches Interesse an Wirtschaft und Management mitgebracht wird.",
    sourceIds: ["whu_tips"],
    checkable: false
  },
  {
    id: "tip_no_typos",
    kind: "tip",
    label: "Keine Flüchtigkeitsfehler",
    detail: "Tippfehler oder andere Flüchtigkeitsfehler sind laut WHU ein absolutes No-Go.",
    sourceIds: ["whu_tips"],
    checkable: false
  },
  {
    id: "tip_values",
    kind: "tip",
    label: "Werte und Persönlichkeit zeigen",
    detail:
      "Die WHU nennt Unternehmergeist, Verantwortungsbewusstsein, den Anspruch Positives zu erreichen und Gemeinschaftsgefühl; als persönliche Eigenschaften Begeisterungsfähigkeit, Teamorientierung, Eigenverantwortung und Neugier.",
    sourceIds: ["whu_tips"],
    checkable: false
  },
  {
    id: "tip_ai_use",
    kind: "tip",
    label: "KI nur als Inspiration, nicht als alleinige Quelle",
    detail:
      "Die WHU hält den verantwortungsbewussten Einsatz von KI-Modellen für eine wichtige Fähigkeit; sie sollen bei der Bewerbung aber bewusst und nicht als alleinige Quelle verwendet werden.",
    sourceIds: ["whu_tips"],
    checkable: false
  },
  {
    id: "own_interview_defensible",
    kind: "own",
    label: "Nur Aussagen, die im Interview tragen",
    detail:
      "Eigene Empfehlung dieser Anwendung: Das finale Interview basiert laut WHU auf Lebenslauf und Motivationsschreiben. Deshalb sollte jede Aussage im Schreiben im Gespräch belegbar sein.",
    sourceIds: [],
    checkable: false
  },
  {
    id: "own_concrete_examples",
    kind: "own",
    label: "Konkrete eigene Beispiele statt Lebenslauf-Nacherzählung",
    detail:
      "Eigene Empfehlung dieser Anwendung: Erlebnisse mit Situation, eigenem Beitrag, Ergebnis und Bezug zum Studium wirken überzeugender als eine Aufzählung von Stationen.",
    sourceIds: [],
    checkable: false
  }
];

// ---------------------------------------------------------------------
// Ausdrücklich NICHT vorgegeben – darf nicht erfunden werden.
// ---------------------------------------------------------------------
export const WHU_NOT_SPECIFIED: { topic: string; note: string }[] = [
  {
    topic: "Wortanzahl",
    note: "Die WHU gibt keine Wortgrenze an, nur maximal 2 Seiten DIN A4. Wortzahlen in dieser Anwendung sind reine Orientierung."
  },
  {
    topic: "Schriftart, Schriftgröße, Rand, Zeilenabstand",
    note: "In den geprüften Quellen keine Vorgabe gefunden. Der Export nutzt gut lesbare Standardwerte."
  },
  {
    topic: "Unterschrift, Datum, Briefkopf",
    note: "In den geprüften Quellen keine Vorgabe gefunden."
  }
];

// ---------------------------------------------------------------------
// Fristen und Verfahren (Studienstart 2027)
// ---------------------------------------------------------------------
export interface AdmissionRound { name: string; applicationDeadline: string; writtenTest: string; interviews: string; }

export const WHU_ADMISSION_2027 = {
  applicationWindow: "15. Oktober 2026 bis 15. Mai 2027",
  studyStart: "01. September 2027",
  proofDeadline: "Englisch- und Praktikumsnachweise müssen spätestens am 15. Mai 2027 vorliegen.",
  note: "Bewerber:innen können jeweils nur an einer der Auswahlrunden teilnehmen.",
  rounds: [
    { name: "Auswahlrunde 1", applicationDeadline: "31. Januar 2027", writtenTest: "19./20. Februar 2027", interviews: "11./12./13. März 2027" },
    { name: "Auswahlrunde 2", applicationDeadline: "31. März 2027", writtenTest: "23./24. April 2027", interviews: "13./14./15. Mai 2027" },
    { name: "Auswahlrunde 3", applicationDeadline: "15. Mai 2027", writtenTest: "4./5. Juni 2027", interviews: "25./26. Juni 2027" }
  ] as AdmissionRound[],
  selectionSteps: [
    "Schriftlicher Test",
    "Online-Assessment (Präsentation und Fragen zu Persönlichkeit und Motivation)",
    "Online-Einzelinterviews"
  ],
  sourceIds: ["whu_apply_de"]
};

// Überprüfbare Programm-Merkmale, die als WHU-Bezug dienen können.
// Bewusst knapp und nur, was auf den geprüften Seiten steht.
export const WHU_PROGRAMME_FACTS: { fact: string; sourceIds: string[] }[] = [
  { fact: "Zwei Standorte: Campus Vallendar und Campus Düsseldorf.", sourceIds: ["whu_apply_de", "whu_tips"] },
  { fact: "Nahezu alle Lehrveranstaltungen finden auf Englisch statt.", sourceIds: ["whu_tips"] },
  { fact: "Studium wahlweise vollständig auf Englisch oder zweisprachig.", sourceIds: ["whu_docs_de", "whu_docs_en"] },
  { fact: "Nachweis fortgeschrittener Englischkenntnisse ist Zulassungsvoraussetzung (z. B. TOEFL iBT min. 95, IELTS Academic min. 7, Cambridge C1 Advanced min. Grade C).", sourceIds: ["whu_docs_de"] },
  { fact: "Vorausgesetzt wird eine Berufsausbildung oder ein wirtschaftsnahes Praktikum von mindestens sechs Wochen (aufteilbar in bis zu drei Abschnitte von je mindestens zwei Wochen).", sourceIds: ["whu_docs_de", "whu_docs_en"] },
  { fact: "Die WHU betont Unternehmergeist, Verantwortungsbewusstsein und Gemeinschaftsgefühl.", sourceIds: ["whu_tips"] },
  { fact: "Nicht nur Noten zählen, sondern auch Persönlichkeit und außerschulisches Engagement.", sourceIds: ["whu_apply_de"] }
];

// Bekannte Abweichung zwischen den Quellen – sichtbar machen, nicht glätten.
export const WHU_SOURCE_CONFLICTS: { topic: string; note: string; sourceIds: string[] }[] = [
  {
    topic: "IELTS-Mindestpunktzahl",
    note: "Das verbindliche Unterlagen-PDF (2026) nennt IELTS Academic mindestens 7. Der ältere Magazin-Artikel nennt 6,5. Maßgeblich ist das Unterlagen-PDF.",
    sourceIds: ["whu_docs_de", "whu_tips"]
  }
];

// ---------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------
export function sourceById(id: string): RequirementSource | null {
  return WHU_SOURCES.find((s) => s.id === id) || null;
}

export function requirementsOfKind(kind: RequirementKind): Requirement[] {
  return WHU_REQUIREMENTS.filter((r) => r.kind === kind);
}

/** Nur die verbindlichen Vorgaben – Grundlage der automatischen Prüfung. */
export function bindingRequirements(): Requirement[] {
  return requirementsOfKind("binding");
}

/**
 * Dateiname nach WHU-Muster: Nachname_Vorname_LM.pdf
 * Umlaute werden transliteriert, da Bewerbungsportale mit Sonderzeichen
 * unzuverlässig umgehen.
 */
export function whuFileName(lastName: string, firstName: string, ext: "pdf" | "docx"): string {
  const clean = (v: string) =>
    (v || "")
      .trim()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const last = clean(lastName) || "Nachname";
  const first = clean(firstName) || "Vorname";
  return `${last}_${first}_LM.${ext}`;
}

// =====================================================================
//  Admissions-Profil: WHU – Otto Beisheim School of Management
//  Bachelor in International Business Administration (BSc)
//
//  Alle Angaben wurden am 13.11.2026 gegen die offiziellen Seiten der
//  Hochschule geprüft. Werte-Texte stehen im ORIGINALWORTLAUT, damit die
//  Engine sie nicht unbemerkt umdeutet.
//
//  Trennung, die durchgehend eingehalten wird:
//    verification "official"  → verbindliche Vorgabe der Hochschule
//    verification "editorial" → redaktioneller Tipp der Hochschule
//    verification "own"       → Empfehlung dieser Anwendung
// =====================================================================

import type { AdmissionsProfile } from "./types";
import { whuFileName } from "../whuRequirements";

const S = {
  docsDe: "whu_docs_de",
  docsEn: "whu_docs_en",
  applyDe: "whu_apply_de",
  applyEn: "whu_apply_en",
  tips: "whu_tips",
  aboutEn: "whu_about_en",
  curriculum: "whu_curriculum"
};

export const WHU_PROFILE: AdmissionsProfile = {
  id: "whu-bsc-iba",
  institution: "WHU – Otto Beisheim School of Management",
  programme: "Bachelor in International Business Administration (Internationale BWL/Management)",
  degree: "Bachelor of Science",
  intake: "01.09.2027",
  languages: ["de", "en"],
  maxPages: 2,
  fileName: whuFileName,

  sources: [
    {
      id: S.docsDe,
      title: "WHU – Bewerbungsunterlagen Bachelor (PDF, DE)",
      url: "https://www.whu.edu/fileadmin/CONTENT/whu.edu/1_Programs/1.1_Bachelor_Program/PDF/Bewerbungsunterlagen_DE_2026.pdf",
      retrievedAt: "2026-11-13",
      caveat: "Jahresangabe 2026 im Dateinamen; zum Prüfzeitpunkt die auf der Bewerbungsseite verlinkte Fassung."
    },
    {
      id: S.docsEn,
      title: "WHU – Application Documents Bachelor (PDF, EN)",
      url: "https://www.whu.edu/fileadmin/CONTENT/whu.edu/1_Programs/1.1_Bachelor_Program/PDF/Application_Documents_EN_2026.pdf",
      retrievedAt: "2026-11-13",
      caveat: "Inhaltsgleich mit der deutschen Fassung."
    },
    {
      id: S.applyDe,
      title: "WHU – Bachelor: Bewerbung und Zulassung",
      url: "https://www.whu.edu/de/programme/bachelor-programm/bachelor-in-internationaler-betriebswirtschaft/bewerbung-zulassung/",
      retrievedAt: "2026-11-13"
    },
    {
      id: S.applyEn,
      title: "WHU – Bachelor: Application & Admissions",
      url: "https://www.whu.edu/en/programs/bachelor-program/bachelor-in-international-business-administration/application-admissions/",
      retrievedAt: "2026-11-13"
    },
    {
      id: S.tips,
      title: "WHU-Magazin – Fünf Tipps für die Bachelor-Bewerbung",
      url: "https://www.whu.edu/de/news-insights/whu-magazin/artikel/fuenf-tipps-fuer-die-bachelor-bewerbung-an-der-whu-otto-beisheim-school-of-management/",
      retrievedAt: "2026-11-13",
      caveat: "Redaktioneller Beitrag, keine verbindliche Vorgabe. Nennt teils ältere Werte (siehe conflicts)."
    },
    {
      id: S.aboutEn,
      title: "WHU – About WHU (Kernwerte, Mission Statement)",
      url: "https://www.whu.edu/en/about-whu/",
      retrievedAt: "2026-11-13"
    },
    {
      id: S.curriculum,
      title: "WHU – Bachelor: Courses & Curriculum",
      url: "https://www.whu.edu/en/programs/bachelor-program/bachelor-in-international-business-administration/courses-curriculum",
      retrievedAt: "2026-11-13"
    }
  ],

  // ------------------------------------------------ Formvorgaben
  formalRules: [
    {
      id: "max_two_pages", label: "Maximal 2 Seiten DIN A4",
      detail: "Umfang: maximal 2 Seiten DIN A4. Wird am tatsächlich gesetzten PDF geprüft, nicht an der Wortzahl.",
      verification: "official", sourceIds: [S.docsDe, S.docsEn], checkable: true
    },
    {
      id: "identity_line", label: "Name, Vorname und Geburtsdatum angeben",
      verification: "official", sourceIds: [S.docsDe, S.docsEn], checkable: true
    },
    {
      id: "no_photo_no_contact", label: "Kein Foto, keine weiteren Kontaktdaten",
      detail: "Ausdrücklich ohne Foto und ohne weitere persönliche Kontaktdaten – also keine Anschrift, Telefonnummer oder E-Mail-Adresse.",
      verification: "official", sourceIds: [S.docsDe, S.docsEn], checkable: true
    },
    {
      id: "file_name", label: "Dateiname: Nachname_Vorname_LM",
      detail: "Das offizielle Unterlagen-PDF gibt „Mustermann_Erika_LM“ vor (ohne Endung). Der WHU-Magazin-Artikel nennt dasselbe Muster mit Endung .pdf.",
      verification: "official", sourceIds: [S.docsDe, S.docsEn, S.tips], checkable: true
    },
    {
      id: "language_matches_round", label: "Sprache = Sprache der Endauswahlrunde",
      detail: "Lebenslauf und Motivationsschreiben auf Deutsch, wenn die Endauswahlrunde auf Deutsch absolviert wird – sonst auf Englisch. Die Sprachwahl beeinflusst die Chancen laut WHU nicht.",
      verification: "official", sourceIds: [S.docsDe, S.docsEn], checkable: false
    }
  ],

  // --------------------------------------- Inhaltliche Pflichtteile
  contentRequirements: [
    {
      id: "motivation_subject",
      label: "Motivation für das Studienfach",
      detail: "Motivation für das Studienfach Internationale BWL/Management.",
      sourceIds: [S.docsDe, S.docsEn]
    },
    {
      id: "motivation_whu",
      label: "Motivation für die WHU",
      detail: "Motivation für die WHU – Otto Beisheim School of Management.",
      sourceIds: [S.docsDe, S.docsEn]
    },
    {
      id: "self_description",
      label: "Selbstbeschreibung",
      detail: "Selbstbeschreibung, zum Beispiel Stärken, Schwächen, Eignung für die WHU und berufliche Ziele.",
      sourceIds: [S.docsDe, S.docsEn]
    }
  ],

  // ------------------------------------------------ Kernwerte
  // Originalwortlaut der WHU. Die evidenceSignals sind BELEG-Fragen
  // dieser Anwendung: Sie helfen, einen Wert an einer echten Handlung
  // festzumachen, statt ihn als Etikett zu vergeben.
  values: [
    {
      key: "excellence",
      label: "Excellence",
      tagline: "Ambition & Performance",
      officialText: "Strive for the best while reaching for ambitious goals and realizing your potential. Have courage to be an excellent leader. Commit to lifelong learning.",
      sourceIds: [S.aboutEn],
      evidenceSignals: [
        "Ein selbst gesetztes Ziel, das über das Geforderte hinausging",
        "Nachweisbare Leistungsentwicklung über Zeit",
        "Eine Situation, in der die Person aus eigenem Antrieb weitergelernt hat"
      ]
    },
    {
      key: "entrepreneurship",
      label: "Entrepreneurship",
      tagline: "Passion & Innovation",
      officialText: "Act courageously, be responsible, think differently. Value failure and learn from it. Innovate to better our communities and foster entrepreneurial spirit in all members of the WHU community.",
      sourceIds: [S.aboutEn],
      evidenceSignals: [
        "Eine Entscheidung unter Unsicherheit, die die Person selbst getroffen hat",
        "Ein Fehlschlag und die konkrete Konsequenz daraus",
        "Eine eigene Initiative ohne äußeren Auftrag"
      ]
    },
    {
      key: "community",
      label: "Community",
      tagline: "Family & Trust",
      officialText: "Rich in differences, inspire each other in a family atmosphere of mutual trust. Look to each other for support as heading towards excellence. Build lifelong bonds with your peers and Alma Mater.",
      sourceIds: [S.aboutEn],
      evidenceSignals: [
        "Verlässlichkeit gegenüber einer Gruppe, auch wenn es unbequem war",
        "Eine Situation, in der die Person jemanden unterstützt hat, ohne Vorteil daraus zu ziehen",
        "Übernommene Verantwortung in einem Team"
      ]
    },
    {
      key: "cosmopoliteness",
      label: "Cosmopoliteness",
      tagline: "Diversity & Internationality",
      officialText: "Be curious about other people, cultures, and approaches. Listen to understand. Treat everybody equally, show acceptance and respect.",
      sourceIds: [S.aboutEn],
      evidenceSignals: [
        "Eine konkrete Begegnung, die die eigene Sicht verändert hat",
        "Zusammenarbeit über Sprach- oder Kulturgrenzen hinweg mit benennbarem Ergebnis",
        "Eine Situation, in der die Person zuerst zugehört statt geurteilt hat"
      ]
    },
    {
      key: "courage_commitment",
      label: "Courage and Commitment",
      officialText: "Our positioning \"We foster Courage and Commitment\" underpins these core values.",
      sourceIds: [S.aboutEn],
      evidenceSignals: [
        "Ein Schritt, der etwas gekostet hat – Zeit, Sicherheit oder Bequemlichkeit",
        "Durchhalten über einen längeren Zeitraum trotz Widerstand"
      ]
    }
  ],

  // ------------------------------------------------ Curriculum
  // Modulnamen wörtlich von der offiziellen Curriculum-Seite.
  curriculum: [
    { semester: "1", name: "The Business Environment: Economic and Ethical Perspectives", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "1", name: "Financial Accounting", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "1", name: "Organizational Behaviour", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "1", name: "Quantitative Methods (Mathematics)", area: "Methoden", sourceIds: [S.curriculum] },
    { semester: "1", name: "Foundations of Law", area: "Recht", sourceIds: [S.curriculum] },
    { semester: "2", name: "Microeconomic Thinking and Market Dynamics", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "2", name: "Marketing & Sales", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "2", name: "Finance", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "2", name: "Quantitative Methods (Statistics)", area: "Methoden", sourceIds: [S.curriculum] },
    { semester: "3", name: "Data-driven Analytics and Decision Making", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "3", name: "Entrepreneurship & Innovation", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "3", name: "Financial Management", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "3", name: "Management Accounting & Control", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "3", name: "Strategic Sourcing and Logistics Management", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "4/5", name: "Sustainable Macroeconomic Thinking", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "4/5", name: "Data Analysis & Management", area: "Methoden", sourceIds: [S.curriculum] },
    { semester: "4/5", name: "Concentrations", area: "Vertiefung", sourceIds: [S.curriculum] },
    { semester: "4/5", name: "Academic Reasoning and Research Practice", area: "Methoden", sourceIds: [S.curriculum] },
    { semester: "6", name: "Strategic Management", area: "Business & Economics", sourceIds: [S.curriculum] },
    { semester: "6", name: "Bachelor Thesis", area: "Abschluss", sourceIds: [S.curriculum] }
  ],

  // ------------------------------------- Überprüfbare Merkmale
  programmeFacts: [
    { fact: "Ein Auslandssemester ist Teil des Curriculums (4. oder 5. Semester, Vallendar oder Exchange Semester Abroad).", sourceIds: [S.curriculum] },
    { fact: "Praktika sind im Studienverlauf fest vorgesehen (nach dem 2. und nach dem 4./5. Semester).", sourceIds: [S.curriculum] },
    { fact: "Sprachkurse sind im Curriculum verankert, z. B. Englisch, Deutsch, Spanisch, Französisch, Chinesisch, Japanisch, Italienisch.", sourceIds: [S.curriculum] },
    { fact: "Das Studium dauert sechs Semester und endet mit der Bachelor Thesis.", sourceIds: [S.curriculum] },
    { fact: "Rund 30 studentische Clubs prägen das Studentenleben in Vallendar und Düsseldorf.", sourceIds: [S.aboutEn] },
    { fact: "Zwei Standorte: Campus Vallendar und Campus Düsseldorf.", sourceIds: [S.applyDe, S.aboutEn] },
    { fact: "Nahezu alle Lehrveranstaltungen finden auf Englisch statt.", sourceIds: [S.tips] },
    { fact: "Vorausgesetzt wird eine Berufsausbildung oder ein wirtschaftsnahes Praktikum von mindestens sechs Wochen.", sourceIds: [S.docsDe, S.docsEn] },
    { fact: "Das Leitbild nennt verantwortliches Entscheiden, Nachhaltigkeit, Inklusion und den reflektierten Einsatz von KI in der Lehre.", sourceIds: [S.aboutEn] },
    { fact: "Nicht nur Noten zählen, sondern auch Persönlichkeit und außerschulisches Engagement.", sourceIds: [S.applyDe] }
  ],

  notSpecified: [
    { topic: "Wortanzahl", note: "Die WHU gibt keine Wortgrenze an, nur maximal 2 Seiten DIN A4. Wortzahlen in dieser Anwendung sind reine Orientierung." },
    { topic: "Schriftart, Schriftgröße, Rand, Zeilenabstand", note: "In den geprüften Quellen keine Vorgabe gefunden. Der Export nutzt gut lesbare Standardwerte." },
    { topic: "Unterschrift, Datum, Briefkopf", note: "In den geprüften Quellen keine Vorgabe gefunden." },
    { topic: "Gewichtung der Inhalte", note: "Die WHU nennt die Pflichtbestandteile, aber keine Reihenfolge oder Gewichtung." }
  ],

  editorialTips: [
    { label: "Ehrlich und authentisch schreiben", detail: "Das Schreiben soll authentisch sein und deutlich machen, warum die Person gut zur WHU passt.", sourceIds: [S.tips] },
    { label: "Keine Flüchtigkeitsfehler", detail: "Tippfehler sind laut WHU ein absolutes No-Go.", sourceIds: [S.tips] },
    { label: "Werte und Persönlichkeit zeigen", detail: "Genannt werden Begeisterungsfähigkeit, Teamorientierung, Eigenverantwortung und Neugier.", sourceIds: [S.tips] },
    { label: "KI nur als Inspiration", detail: "Die WHU hält den verantwortungsbewussten Einsatz von KI für eine wichtige Fähigkeit, warnt aber davor, sie als alleinige Quelle zu nutzen.", sourceIds: [S.tips] },
    { label: "Interview beruht auf CV und Motivationsschreiben", detail: "Das finale Interview basiert laut WHU auf Lebenslauf und Motivationsschreiben.", sourceIds: [S.tips] }
  ],

  conflicts: [
    {
      topic: "IELTS-Mindestpunktzahl",
      note: "Das verbindliche Unterlagen-PDF nennt IELTS Academic mindestens 7. Der ältere Magazin-Artikel nennt 6,5. Maßgeblich ist das Unterlagen-PDF.",
      sourceIds: [S.docsDe, S.tips]
    },
    {
      topic: "Fristjahr im Magazin-Artikel",
      note: "Der Magazin-Artikel nennt den 15. Mai 2026 als Stichtag. Für den Studienstart 2027 gilt der 15. Mai 2027 laut Bewerbungsseite.",
      sourceIds: [S.tips, S.applyDe]
    }
  ]
};

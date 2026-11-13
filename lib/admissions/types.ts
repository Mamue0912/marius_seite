// =====================================================================
//  Modulares Admissions-Profil
//
//  Die Schreib-Engine kennt KEINE Hochschule fest. Sie arbeitet gegen
//  dieses Profil. Eine weitere Universität ergänzt man, indem man ein
//  weiteres Profil anlegt und in lib/admissions/index.ts registriert –
//  ohne Änderung an Pipeline, Prüfung oder Oberfläche.
// =====================================================================

export type Verification = "official" | "editorial" | "own";

export interface SourceRef {
  id: string;
  title: string;
  url: string;
  /** Datum der Prüfung durch diese Anwendung. */
  retrievedAt: string;
  /** Veröffentlichungsdatum, falls auf der Quelle angegeben. */
  publishedAt?: string;
  /** Bekannte Unsicherheit, z. B. „Jahresangabe im Dateinamen". */
  caveat?: string;
}

/** Ein Wert der Hochschule, im Originalwortlaut belegt. */
export interface InstitutionValue {
  key: string;
  label: string;
  /** Originaltext der Hochschule – NICHT paraphrasiert. */
  officialText: string;
  /** Schlagworte der Hochschule zu diesem Wert. */
  tagline?: string;
  sourceIds: string[];
  /**
   * Woran man im Lebenslauf erkennt, dass jemand diesen Wert tatsächlich
   * gelebt hat. Bewusst als BELEG-Frage formuliert, nicht als Etikett:
   * Werte dürfen nicht nachträglich hineingedeutet werden.
   */
  evidenceSignals: string[];
}

export interface CurriculumModule {
  semester: string;
  name: string;
  area: string;
  sourceIds: string[];
}

export interface FormalRule {
  id: string;
  label: string;
  detail?: string;
  verification: Verification;
  sourceIds: string[];
  /** Kann die Anwendung das automatisch prüfen? */
  checkable: boolean;
}

export interface ContentRequirement {
  id: string;
  label: string;
  detail: string;
  sourceIds: string[];
}

export interface AdmissionsProfile {
  id: string;
  institution: string;
  programme: string;
  degree: string;
  intake: string;
  languages: ("de" | "en")[];
  sources: SourceRef[];
  /** Verbindliche Formvorgaben (Seitenzahl, Dateiname …). */
  formalRules: FormalRule[];
  /** Inhaltliche Pflichtbestandteile des Schreibens. */
  contentRequirements: ContentRequirement[];
  values: InstitutionValue[];
  curriculum: CurriculumModule[];
  /** Überprüfbare Programmmerkmale (Auslandssemester, Praktika …). */
  programmeFacts: { fact: string; sourceIds: string[] }[];
  /** Was die Hochschule NICHT vorgibt – darf nie erfunden werden. */
  notSpecified: { topic: string; note: string }[];
  /** Redaktionelle Tipps der Hochschule, klar getrennt von Vorgaben. */
  editorialTips: { label: string; detail: string; sourceIds: string[] }[];
  /** Bekannte Widersprüche zwischen Quellen. */
  conflicts: { topic: string; note: string; sourceIds: string[] }[];
  /** Dateiname für den Export. */
  fileName: (lastName: string, firstName: string, ext: "pdf" | "docx") => string;
  maxPages: number;
}

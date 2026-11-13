// Registrierung der Admissions-Profile. Eine weitere Hochschule wird hier
// ergänzt; Pipeline, Prüfung und Oberfläche bleiben unverändert.
import type { AdmissionsProfile, SourceRef } from "./types";
import { WHU_PROFILE } from "./whu";

export * from "./types";
export { WHU_PROFILE };

export const PROFILES: Record<string, AdmissionsProfile> = {
  [WHU_PROFILE.id]: WHU_PROFILE
};

export const DEFAULT_PROFILE_ID = WHU_PROFILE.id;

export function profileById(id?: string | null): AdmissionsProfile {
  return (id && PROFILES[id]) || PROFILES[DEFAULT_PROFILE_ID];
}

export function sourceOf(profile: AdmissionsProfile, id: string): SourceRef | null {
  return profile.sources.find((s) => s.id === id) || null;
}

/** Nur automatisch prüfbare Formvorgaben. */
export function checkableRules(profile: AdmissionsProfile) {
  return profile.formalRules.filter((r) => r.checkable);
}

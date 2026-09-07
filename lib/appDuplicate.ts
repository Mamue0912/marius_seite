import { normalizeJobUrl } from "./jobPostingExtract";
import { supabaseAdmin } from "./supabaseAdmin";

const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
const normUrl = (s: string | null | undefined) => { try { return normalizeJobUrl(s || ""); } catch { return ""; } };

// Prüft, ob es zu einer gerade angelegten Bewerbung bereits eine bestehende
// gibt, die dieselbe Stelle beschreibt: gleiche Firma UND Position, oder
// dieselbe Stellen-URL. Gibt die bestehende (ältere) Bewerbung zurück oder null.
export async function findDuplicateApplication(
  userId: string,
  candidate: { id: string; company: string | null; position: string | null; job_url: string | null }
): Promise<{ id: string; company: string | null; position: string | null } | null> {
  const { data } = await supabaseAdmin()
    .from("applications")
    .select("id,company,position,job_url,created_at")
    .eq("user_id", userId)
    .neq("id", candidate.id)
    .order("created_at", { ascending: true });
  if (!data) return null;

  const cCompany = norm(candidate.company);
  const cPos = norm(candidate.position);
  const cUrl = normUrl(candidate.job_url);

  for (const a of data) {
    const urlMatch = cUrl && normUrl(a.job_url) === cUrl;
    const companyMatch = cCompany && norm(a.company) === cCompany;
    const posMatch = cPos && norm(a.position) === cPos;
    if (urlMatch || (companyMatch && posMatch)) {
      return { id: a.id, company: a.company, position: a.position };
    }
  }
  return null;
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { matchJobsToProfile, aiConfigured } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Angebotsart der Arbeitsagentur-API: 1=Arbeit, 4=Ausbildung/Duales Studium,
// 34=Praktikum/Trainee. "alle" lässt den Filter weg.
const ART_LABEL: Record<string, string> = { "1": "Stelle", "4": "Ausbildung", "34": "Praktikum" };

interface Job {
  id: string; title: string; employer: string; location: string;
  type: string; date: string | null; url: string; reason?: string;
}

// Echte Stellensuche über die kostenlose Jobsuche-API der Bundesagentur für
// Arbeit (öffentlicher X-API-Key). Optional per KI auf das Profil zugeschnitten.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const was = String(b.was || "").trim();
  const wo = String(b.wo || "").trim();
  const umkreis = parseInt(String(b.umkreis || "25"), 10) || 25;
  const angebotsart = String(b.angebotsart || "");
  const page = Math.max(1, parseInt(String(b.page || "1"), 10) || 1);
  const tailor = !!b.tailor;

  const p = new URLSearchParams();
  if (was) p.set("was", was);
  if (wo) p.set("wo", wo);
  if (wo) p.set("umkreis", String(umkreis));
  if (angebotsart && ART_LABEL[angebotsart]) p.set("angebotsart", angebotsart);
  p.set("page", String(page));
  p.set("size", "25");

  let data: any;
  try {
    const res = await fetch(`https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs?${p.toString()}`, {
      headers: { "X-API-Key": "jobboerse-jobsuche", accept: "application/json" },
      cache: "no-store"
    });
    if (!res.ok) return NextResponse.json({ error: "search_failed", message: `Stellensuche nicht erreichbar (${res.status}).` }, { status: 502 });
    data = await res.json();
  } catch (e) {
    return NextResponse.json({ error: "search_failed", message: (e as Error).message }, { status: 502 });
  }

  const raw: any[] = data.stellenangebote || [];
  const typeLabel = ART_LABEL[angebotsart] || "Stelle";
  const jobs: Job[] = raw.map((s: any) => {
    const ort = s.arbeitsort || {};
    const location = [ort.ort, ort.plz].filter(Boolean).join(" ") || ort.region || ort.land || "—";
    const refnr = s.refnr || s.hashId || "";
    const url = s.externeUrl || (refnr ? `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(refnr)}` : "https://www.arbeitsagentur.de/jobsuche/");
    return {
      id: String(refnr || s.hashId || Math.random()),
      title: s.titel || s.beruf || "Stelle",
      employer: s.arbeitgeber || "—",
      location,
      type: typeLabel,
      date: s.aktuelleVeroeffentlichungsdatum || null,
      url
    };
  });

  const total = data.maxErgebnisse || jobs.length;

  // Optional: auf das Profil zuschneiden (bestätigte Fakten + Wünsche).
  let tailored = false;
  if (tailor && jobs.length && aiConfigured()) {
    try {
      const { data: facts } = await supabaseAdmin()
        .from("app_document_facts").select("category,value").eq("user_id", user.id).eq("status", "bestaetigt");
      const factsText = (facts || []).map((f: any) => `- ${f.value}`).join("\n");
      if (factsText.trim()) {
        const { picks } = await matchJobsToProfile({ factsText, wishes: was, jobs });
        const reasonBy = new Map<number, string>();
        for (const pk of picks || []) if (pk.index >= 0 && pk.index < jobs.length) reasonBy.set(pk.index, pk.reason);
        if (reasonBy.size) {
          const ranked: Job[] = [];
          for (const pk of picks) { const j = jobs[pk.index]; if (j && !ranked.includes(j)) { j.reason = pk.reason; ranked.push(j); } }
          for (const j of jobs) if (!ranked.includes(j)) ranked.push(j);
          jobs.splice(0, jobs.length, ...ranked);
          tailored = true;
        }
      }
    } catch { /* KI-Zuschneidung optional – bei Fehler bleibt die normale Liste */ }
  }

  return NextResponse.json({ jobs, total, page, tailored });
}

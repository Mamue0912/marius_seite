import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadProfile } from "@/lib/motivationContext";
import { missingProfileFields } from "@/lib/motivation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_FIELDS = ["city", "school", "graduationYear", "grade", "interests", "goals", "experiences", "planned"] as const;
const MAX_FIELD = 4000;

// GET: persönliches Profil des angemeldeten Nutzers (nie fremde Daten).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const profile = await loadProfile(user.id);
    return NextResponse.json({ profile, missing: missingProfileFields(profile) });
  } catch (e) {
    return NextResponse.json({ error: "db_error", message: (e as Error).message }, { status: 500 });
  }
}

// PUT: Profil anlegen/aktualisieren.
export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request", message: "Ungültige Eingabe." }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_FIELD) : null);
  const extra: Record<string, string | null> = {};
  for (const key of TEXT_FIELDS) extra[key] = str(body[key]);

  // Geburtsdatum muss ein echtes Datum sein, sonst lieber nichts speichern.
  let birth: string | null = null;
  if (typeof body.birthDate === "string" && body.birthDate.trim()) {
    const d = body.birthDate.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) {
      return NextResponse.json({ error: "bad_request", message: "Das Geburtsdatum ist ungültig (erwartet: JJJJ-MM-TT)." }, { status: 400 });
    }
    birth = d;
  }

  const row = {
    user_id: user.id,
    first_name: str(body.firstName),
    last_name: str(body.lastName),
    birth_date: birth,
    profile: extra,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabaseAdmin().from("motivation_profile").upsert(row, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "db_error", message: "Das Profil konnte nicht gespeichert werden." }, { status: 500 });

  const profile = await loadProfile(user.id).catch(() => null);
  return NextResponse.json({ ok: true, profile, missing: profile ? missingProfileFields(profile) : [] });
}

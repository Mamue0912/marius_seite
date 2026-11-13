import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { WHU_BACHELOR } from "@/lib/whuRequirements";
import { defaultOutline } from "@/lib/motivation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: alle Motivationsschreiben des Nutzers.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin()
    .from("motivation_letters").select("*").eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "db_error", message: "Die Schreiben konnten nicht geladen werden." }, { status: 500 });
  return NextResponse.json({ letters: data || [] });
}

// POST: neues Schreiben anlegen. Ohne Angaben mit WHU-Voreinstellung.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const language = body.language === "en" ? "en" : "de";
  const custom = body.preset === "custom";
  const insert = {
    user_id: user.id,
    preset: custom ? "custom" : "whu_bachelor",
    institution: (typeof body.institution === "string" && body.institution.trim())
      ? body.institution.trim().slice(0, 300)
      : WHU_BACHELOR.institution,
    programme: (typeof body.programme === "string" && body.programme.trim())
      ? body.programme.trim().slice(0, 300)
      : WHU_BACHELOR.programme,
    intake: (typeof body.intake === "string" && body.intake.trim())
      ? body.intake.trim().slice(0, 100)
      : (custom ? null : WHU_BACHELOR.intake),
    language,
    title: (typeof body.title === "string" && body.title.trim()) ? body.title.trim().slice(0, 300) : null,
    outline: defaultOutline(language),
    body: "",
    stage: "entwurf"
  };

  const { data, error } = await supabaseAdmin().from("motivation_letters").insert(insert).select("*").single();
  if (error) return NextResponse.json({ error: "db_error", message: "Das Schreiben konnte nicht angelegt werden." }, { status: 500 });
  return NextResponse.json({ letter: data });
}

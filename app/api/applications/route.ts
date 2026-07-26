import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: alle Bewerbungen (Übersicht/Liste).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabaseAdmin().from("applications").select("*").eq("user_id", user.id).order("last_activity_at", { ascending: false });
  return NextResponse.json({ applications: data || [] });
}

// POST: leere Bewerbung anlegen (z. B. manuell, ohne Link).
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const insert: any = {
    user_id: user.id,
    company: body.company || null,
    position: body.position || null,
    status: body.status || "interessant"
  };
  // Optionale Vorbelegung (z. B. aus der Stellensuche übernommen).
  if (body.job_url) insert.job_url = String(body.job_url).slice(0, 2000);
  if (body.job_type) insert.job_type = String(body.job_type);
  if (body.job_source) insert.job_source = String(body.job_source);
  if (body.contact) insert.contact = String(body.contact);
  const { data, error } = await supabaseAdmin().from("applications").insert(insert).select("*").single();
  if (error) return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
  return NextResponse.json({ application: data });
}

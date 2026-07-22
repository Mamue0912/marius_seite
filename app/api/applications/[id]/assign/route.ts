import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unterlagen einer Bewerbung zuordnen / entfernen.
// POST { documentId, action: "add" | "remove" }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: app } = await admin.from("applications").select("id").eq("id", params.id).eq("user_id", user.id).maybeSingle();
  if (!app) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { documentId, action } = await req.json().catch(() => ({}));
  if (!documentId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const { data: doc } = await admin.from("app_documents").select("id").eq("id", documentId).eq("user_id", user.id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "doc_not_found" }, { status: 404 });

  if (action === "remove") {
    await admin.from("application_documents").delete().eq("application_id", app.id).eq("document_id", documentId);
  } else {
    await admin.from("application_documents").upsert({ application_id: app.id, document_id: documentId, user_id: user.id }, { onConflict: "application_id,document_id" });
  }
  await admin.from("applications").update({ last_activity_at: new Date().toISOString() }).eq("id", app.id);
  return NextResponse.json({ ok: true });
}

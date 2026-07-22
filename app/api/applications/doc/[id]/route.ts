import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildDocx, safeFileName } from "@/lib/docxBuilder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function owned(userId: string, id: string) {
  const { data } = await supabaseAdmin().from("application_docs").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data;
}

// GET ?format=docx → DOCX-Download. Sonst JSON.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (new URL(req.url).searchParams.get("format") === "docx") {
    const { data: app } = await supabaseAdmin().from("applications").select("company,position").eq("id", doc.application_id).maybeSingle();
    const buffer = await buildDocx({ title: doc.title || doc.kind, body: doc.body });
    const fname = safeFileName([app?.company, doc.kind], "docx");
    return new NextResponse(buffer as any, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${fname}"`
      }
    });
  }
  return NextResponse.json({ doc });
}

// PATCH: Titel/Text im Cockpit bearbeiten.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const update: any = { updated_at: new Date().toISOString() };
  if (typeof body.body === "string") update.body = body.body;
  if (typeof body.title === "string") update.title = body.title;
  await supabaseAdmin().from("application_docs").update(update).eq("id", doc.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await owned(user.id, params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await supabaseAdmin().from("application_docs").delete().eq("id", doc.id);
  return NextResponse.json({ ok: true });
}

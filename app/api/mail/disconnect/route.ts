import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trennt ein IMAP-Konto: löscht Zugangsdaten und dessen Nachrichten.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* optional */
  }
  const admin = supabaseAdmin();

  const result = body.id
    ? await admin.from("mail_accounts").delete().eq("id", body.id).eq("user_id", user.id)
    : await admin.from("mail_accounts").delete().eq("user_id", user.id);
  if (result.error) return NextResponse.json({ error: "db_error", message: "Das Mailkonto konnte nicht getrennt werden." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ordner des Nutzers (inkl. lokaler Anzeigeeinstellungen).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();
  let res: any = await admin.from("mail_folders").select("id,account_id,path,folder_type,unread,total,display_name,sort_order,hidden,type_override").eq("user_id", user.id);
  if (res.error) res = await admin.from("mail_folders").select("id,account_id,path,folder_type,unread,total").eq("user_id", user.id);
  return NextResponse.json({ folders: res.data || [] });
}

// PATCH: NUR lokale Cockpit-Anzeige ändern (Anzeigename, Sichtbarkeit,
// Reihenfolge, Typ-Zuordnung). Der IMAP-Ordner auf dem Server bleibt
// unverändert.
export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.account_id || b.path === undefined) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const update: any = {};
  if (b.display_name !== undefined) update.display_name = b.display_name || null;
  if (b.hidden !== undefined) update.hidden = !!b.hidden;
  if (b.sort_order !== undefined) update.sort_order = b.sort_order;
  if (b.type_override !== undefined) update.type_override = b.type_override || null;
  if (!Object.keys(update).length) return NextResponse.json({ ok: true });
  const { error } = await supabaseAdmin().from("mail_folders").update(update)
    .eq("user_id", user.id).eq("account_id", b.account_id).eq("path", b.path);
  if (error) return NextResponse.json({ error: error.message, message: "Konnte Anzeige nicht speichern. Ist schema_mail_folders.sql ausgeführt?" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

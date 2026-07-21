import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { deleteSubscriptions } from "@/lib/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trennt das Microsoft-Konto: Abos löschen, Tokens und Nachrichten entfernen.
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: accounts } = await admin.from("ms_accounts").select("*").eq("user_id", user.id);

  for (const acc of accounts || []) {
    try {
      await deleteSubscriptions(acc as any);
    } catch {
      /* Abos laufen sonst von allein ab */
    }
  }
  // Nachrichten + Konten (inkl. verschlüsselter Tokens) löschen.
  await admin.from("messages").delete().eq("user_id", user.id);
  await admin.from("ms_accounts").delete().eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decrypt } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trennt das Google-Konto: Zugriff bei Google widerrufen, Tokens löschen.
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: accounts, error: accountsError } = await admin.from("google_accounts").select("*").eq("user_id", user.id);
  if (accountsError) return NextResponse.json({ error: "db_error", message: "Google-Verbindung konnte nicht geladen werden." }, { status: 500 });
  let revokeFailed = false;
  for (const acc of accounts || []) {
    const enc = (acc as any).refresh_token_enc || (acc as any).access_token_enc;
    if (enc) {
      try {
        const token = decrypt(enc);
        const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
        if (!response.ok) revokeFailed = true;
      } catch { revokeFailed = true; }
    }
  }
  const { error: deleteError } = await admin.from("google_accounts").delete().eq("user_id", user.id);
  if (deleteError) return NextResponse.json({ error: "db_error", message: "Google-Kalender konnte nicht getrennt werden." }, { status: 500 });
  return NextResponse.json({ ok: true, warning: revokeFailed ? "Die lokale Verbindung wurde getrennt; der Widerruf bei Google konnte nicht bestätigt werden." : undefined });
}

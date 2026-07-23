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
  const { data: accounts } = await admin.from("google_accounts").select("*").eq("user_id", user.id);
  for (const acc of accounts || []) {
    const enc = (acc as any).refresh_token_enc || (acc as any).access_token_enc;
    if (enc) {
      try {
        const token = decrypt(enc);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
      } catch { /* Widerruf best effort */ }
    }
  }
  await admin.from("google_accounts").delete().eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runDelta } from "@/lib/sync";
import { ensureSubscriptions } from "@/lib/subscriptions";
import { FOLDERS } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manuelle Aktualisierung + „beim Öffnen des Cockpits": nur Delta (Änderungen),
// stellt außerdem sicher, dass die Live-Abos existieren.
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: accounts } = await supabaseAdmin().from("ms_accounts").select("*").eq("user_id", user.id);
  if (!accounts?.length) return NextResponse.json({ connected: false });

  let processed = 0;
  for (const acc of accounts) {
    try {
      await ensureSubscriptions(acc as any);
      for (const f of FOLDERS) processed += await runDelta(acc as any, f);
    } catch (e) {
      console.error("Manual sync failed:", (e as Error).message);
    }
  }
  return NextResponse.json({ connected: true, processed });
}

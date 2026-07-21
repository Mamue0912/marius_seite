import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "../_auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runDelta } from "@/lib/sync";
import { env, FOLDERS, Folder } from "@/lib/env";
import { MsAccount } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cron (alle 3 Min., siehe vercel.json): Sicherheitsnetz. Kam für ein
// Konto/Ordner seit FALLBACK_DELTA_MINUTES kein Webhook, wird trotzdem eine
// Delta-Query ausgeführt (nur Änderungen). So gehen keine Mails verloren,
// falls eine Webhook-Benachrichtigung mal ausbleibt.
export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req);
  if (denied) return denied;

  const admin = supabaseAdmin();
  const cutoff = Date.now() - env.fallbackDeltaMinutes() * 60_000;

  try {
    const { data: accounts } = await admin
      .from("ms_accounts")
      .select("*")
      .eq("status", "connected");

    let synced = 0;
    for (const acc of (accounts || []) as MsAccount[]) {
      const { data: states } = await admin
        .from("sync_state")
        .select("folder,last_webhook_at")
        .eq("account_id", acc.id);
      const webhookAt = new Map<string, string | null>(
        (states || []).map((s) => [s.folder, s.last_webhook_at])
      );

      for (const folder of FOLDERS) {
        const last = webhookAt.get(folder);
        const lastMs = last ? new Date(last).getTime() : 0;
        if (lastMs >= cutoff) continue; // kürzlich per Webhook aktualisiert
        try {
          await runDelta(acc, folder as Folder);
          synced++;
        } catch (e) {
          console.error(`delta-fallback failed (${folder}):`, (e as Error).message);
        }
      }
    }
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    console.error("delta-fallback cron failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "fallback_failed" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { timingSafeEqual } from "@/lib/crypto";
import { runDelta } from "@/lib/sync";
import { ensureSubscriptions } from "@/lib/subscriptions";
import { Folder } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Microsoft Graph sendet bei der Abo-Erstellung eine Validierungsanfrage mit
// ?validationToken=... — dieser Token muss unverändert als text/plain zurück.
function validationResponse(req: NextRequest): NextResponse | null {
  const token = new URL(req.url).searchParams.get("validationToken");
  if (token == null) return null;
  return new NextResponse(token, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function GET(req: NextRequest) {
  return validationResponse(req) ?? NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  // 1) Validierungsanfrage sofort beantworten.
  const v = validationResponse(req);
  if (v) return v;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("ok", { status: 202 });
  }
  const notifications: any[] = body?.value || [];

  // 2) Schnell annehmen, dann verarbeiten. (Für hohe Last: hier in eine Queue
  //    schieben statt inline zu verarbeiten – siehe SETUP-Doku.)
  try {
    await processNotifications(notifications);
  } catch (e) {
    // Fehler protokollieren, aber trotzdem 202 – Graph wiederholt sonst endlos.
    console.error("Webhook processing error:", (e as Error).message);
  }
  return new NextResponse("accepted", { status: 202 });
}

async function processNotifications(notifications: any[]): Promise<void> {
  const admin = supabaseAdmin();
  const toSync = new Map<string, { account: any; folder: Folder }>();

  for (const n of notifications) {
    const subId = n.subscriptionId;
    if (!subId) continue;

    const { data: sub } = await admin
      .from("graph_subscriptions")
      .select("*")
      .eq("subscription_id", subId)
      .maybeSingle();
    if (!sub) continue;

    // 3) clientState streng validieren – sonst ablehnen (gefälschte Benachrichtigung).
    if (!n.clientState || !timingSafeEqual(String(n.clientState), sub.client_state)) {
      console.warn("Webhook: clientState mismatch – ignoriert.");
      continue;
    }

    // Lifecycle-Benachrichtigungen (Abo muss erneuert/neu erstellt werden).
    if (n.lifecycleEvent) {
      const { data: account } = await admin.from("ms_accounts").select("*").eq("id", sub.account_id).maybeSingle();
      if (account) {
        try {
          await ensureSubscriptions(account as any);
        } catch (e) {
          console.error("Lifecycle re-subscribe failed:", (e as Error).message);
        }
      }
      continue;
    }

    // 4) Idempotenz: doppelte Benachrichtigungen überspringen.
    const dedupe = `${subId}:${n.resourceData?.id || ""}:${n.changeType || ""}`;
    const { error: dupErr } = await admin.from("processed_notifications").insert({ dedupe_key: dedupe });
    if (dupErr) continue; // bereits verarbeitet (Primärschlüssel-Konflikt)

    // last_webhook_at aktualisieren (für die Fallback-Kontrolle).
    await admin
      .from("sync_state")
      .upsert(
        { user_id: sub.user_id, account_id: sub.account_id, folder: sub.folder, last_webhook_at: new Date().toISOString() },
        { onConflict: "account_id,folder" }
      );

    if (!toSync.has(sub.account_id + sub.folder)) {
      const { data: account } = await admin.from("ms_accounts").select("*").eq("id", sub.account_id).maybeSingle();
      if (account) toSync.set(sub.account_id + sub.folder, { account, folder: sub.folder as Folder });
    }
  }

  // 5) Nicht auf das Payload verlassen – tatsächliche Änderungen per Delta laden.
  for (const { account, folder } of toSync.values()) {
    try {
      await runDelta(account, folder);
    } catch (e) {
      console.error(`Delta after webhook failed (${folder}):`, (e as Error).message);
    }
  }
}

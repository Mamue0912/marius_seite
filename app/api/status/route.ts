import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Verbindungs- und Sync-Status für die dezente Statusanzeige im Cockpit.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: account } = await admin
    .from("ms_accounts")
    .select("id,email,display_name,status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!account) {
    return NextResponse.json({ connected: false, status: "disconnected" });
  }

  const { data: sync } = await admin
    .from("sync_state")
    .select("folder,last_delta_at,last_webhook_at")
    .eq("account_id", account.id);
  const { data: subs } = await admin
    .from("graph_subscriptions")
    .select("expires_at,status")
    .eq("account_id", account.id);

  const maxOf = (arr: (string | null | undefined)[]) =>
    arr.filter(Boolean).map((s) => new Date(s as string).getTime()).sort((a, b) => b - a)[0] || null;

  const lastWebhook = maxOf((sync || []).map((s) => s.last_webhook_at));
  const lastDelta = maxOf((sync || []).map((s) => s.last_delta_at));
  const subExpiry = maxOf((subs || []).map((s) => s.expires_at));
  const hasActiveSub = (subs || []).some((s) => s.status === "active");

  return NextResponse.json({
    connected: true,
    status: account.status, // connected | needs_reauth | disconnected
    email: account.email,
    displayName: account.display_name,
    live: hasActiveSub && account.status === "connected",
    lastWebhookAt: lastWebhook ? new Date(lastWebhook).toISOString() : null,
    lastDeltaAt: lastDelta ? new Date(lastDelta).toISOString() : null,
    subscriptionExpiresAt: subExpiry ? new Date(subExpiry).toISOString() : null,
    fallbackIntervalMinutes: env.fallbackDeltaMinutes()
  });
}

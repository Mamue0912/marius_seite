import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "../_auth";
import { renewAllExpiring } from "@/lib/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cron (alle 30 Min., siehe vercel.json): verlängert alle bald ablaufenden
// Graph-Abos deutlich vor Ablauf und legt verlorene Abos neu an. So bleibt
// der Live-Webhook dauerhaft aktiv, ohne dass der/die Nutzer:in etwas tut.
export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req);
  if (denied) return denied;

  try {
    const result = await renewAllExpiring();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("renew-subscriptions cron failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "renew_failed" }, { status: 500 });
  }
}

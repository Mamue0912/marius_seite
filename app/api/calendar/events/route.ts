import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleToken, fetchGoogleEvents, GoogleAccount } from "@/lib/googleCalendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Liefert Google-Kalender-Termine im angefragten Zeitfenster.
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: acc } = await supabaseAdmin()
    .from("google_accounts").select("*").eq("user_id", user.id).maybeSingle();
  if (!acc) return NextResponse.json({ connected: false, events: [] });
  if ((acc as any).status === "needs_reauth") {
    return NextResponse.json({ connected: true, needsReauth: true, events: [] });
  }

  const url = new URL(req.url);
  const now = new Date();
  const defMin = new Date(now.getFullYear(), now.getMonth(), 1);
  const defMax = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const timeMin = url.searchParams.get("timeMin") || defMin.toISOString();
  const timeMax = url.searchParams.get("timeMax") || defMax.toISOString();

  try {
    const token = await getValidGoogleToken(acc as GoogleAccount);
    const events = await fetchGoogleEvents(token, timeMin, timeMax);
    return NextResponse.json({ connected: true, email: (acc as any).email, events });
  } catch (e: any) {
    if (e?.oauthError === "invalid_grant") {
      return NextResponse.json({ connected: true, needsReauth: true, events: [] });
    }
    return NextResponse.json({ connected: true, error: (e as Error).message, events: [] }, { status: 502 });
  }
}

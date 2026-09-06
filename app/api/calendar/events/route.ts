import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleToken, fetchGoogleEvents, GoogleAccount, CalendarEvent } from "@/lib/googleCalendar";
import { fetchIcloudEvents, IcloudAccount } from "@/lib/icloudCalendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Liefert Kalender-Termine im angefragten Zeitfenster – zusammengeführt aus
// Google-Kalender und iCloud-Kalender (CalDAV). Fällt eine Quelle aus, werden
// die Termine der anderen trotzdem geliefert.
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const [{ data: gAcc }, { data: iAcc }] = await Promise.all([
    admin.from("google_accounts").select("*").eq("user_id", user.id).maybeSingle(),
    admin.from("icloud_accounts").select("*").eq("user_id", user.id).maybeSingle()
  ]);

  const connected = !!gAcc || !!iAcc;
  if (!connected) return NextResponse.json({ connected: false, events: [] });

  const url = new URL(req.url);
  const now = new Date();
  const defMin = new Date(now.getFullYear(), now.getMonth(), 1);
  const defMax = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const timeMin = url.searchParams.get("timeMin") || defMin.toISOString();
  const timeMax = url.searchParams.get("timeMax") || defMax.toISOString();

  const events: CalendarEvent[] = [];
  const errors: string[] = [];
  let needsReauth = false;

  // Google
  if (gAcc) {
    if ((gAcc as any).status === "needs_reauth") {
      needsReauth = true;
    } else {
      try {
        const token = await getValidGoogleToken(gAcc as GoogleAccount);
        events.push(...(await fetchGoogleEvents(token, timeMin, timeMax)));
      } catch (e: any) {
        if (e?.oauthError === "invalid_grant") needsReauth = true;
        else errors.push(`Google: ${(e as Error).message}`);
      }
    }
  }

  // iCloud (CalDAV)
  if (iAcc) {
    try {
      events.push(...(await fetchIcloudEvents(iAcc as IcloudAccount, timeMin, timeMax)));
    } catch (e) {
      errors.push(`iCloud: ${(e as Error).message}`);
      await admin.from("icloud_accounts")
        .update({ last_error: (e as Error).message, updated_at: new Date().toISOString() })
        .eq("id", (iAcc as any).id);
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  const email = (gAcc as any)?.email || (iAcc as any)?.apple_id || null;

  // needsReauth nur melden, wenn Google die einzige (betroffene) Quelle ist –
  // sonst zeigen wir die iCloud-Termine ganz normal an.
  if (needsReauth && !iAcc) {
    return NextResponse.json({ connected: true, needsReauth: true, events: [] });
  }
  return NextResponse.json({
    connected: true,
    email,
    events,
    error: errors.length ? errors.join(" · ") : undefined
  });
}

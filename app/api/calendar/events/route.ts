import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleToken, fetchGoogleEvents, GoogleAccount, CalendarEvent } from "@/lib/googleCalendar";
import { fetchIcloudSnapshot, IcloudAccount, IcloudAuthError } from "@/lib/icloudCalendar";
import { syncIcloudTasks } from "@/lib/calendarTaskSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeIcloudError(error: unknown): string {
  if (error instanceof IcloudAuthError) return "Zugangsdaten oder Berechtigung sind ungültig. Bitte iCloud erneut verbinden.";
  const message = error instanceof Error ? error.message : "";
  if (message.includes("keine Kalender") || message.includes("Keine iCloud-Kalender")) return message;
  return "Die Synchronisierung mit Apple ist fehlgeschlagen. Bitte erneut versuchen.";
}

export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const [googleResult, icloudResult] = await Promise.all([
    admin.from("google_accounts").select("*").eq("user_id", user.id).maybeSingle(),
    admin.from("icloud_accounts").select("*").eq("user_id", user.id).maybeSingle()
  ]);
  const gAcc = googleResult.data;
  const iAcc = icloudResult.data;
  const connected = !!gAcc || !!iAcc;
  if (!connected) return NextResponse.json({ connected: false, events: [], sources: {} });

  const url = new URL(req.url);
  const now = new Date();
  const defMin = new Date(now.getFullYear(), now.getMonth(), 1);
  const defMax = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const minDate = new Date(url.searchParams.get("timeMin") || defMin.toISOString());
  const maxDate = new Date(url.searchParams.get("timeMax") || defMax.toISOString());
  if (!Number.isFinite(minDate.getTime()) || !Number.isFinite(maxDate.getTime()) || minDate >= maxDate || maxDate.getTime() - minDate.getTime() > 730 * 864e5) {
    return NextResponse.json({ error: "bad_range", message: "Der Kalenderzeitraum ist ungültig." }, { status: 400 });
  }
  const timeMin = minDate.toISOString();
  const timeMax = maxDate.toISOString();

  const events: CalendarEvent[] = [];
  const errors: string[] = [];
  const sources: Record<string, Record<string, unknown>> = {};
  let needsReauth = false;
  let taskSyncError: string | undefined;

  if (gAcc) {
    if ((gAcc as GoogleAccount).status === "needs_reauth") {
      needsReauth = true;
      sources.google = { state: "needs_reauth", events: 0 };
    } else {
      try {
        const token = await getValidGoogleToken(gAcc as GoogleAccount);
        const googleEvents = await fetchGoogleEvents(token, timeMin, timeMax);
        events.push(...googleEvents);
        sources.google = { state: googleEvents.length ? "connected" : "empty", events: googleEvents.length };
      } catch (error: any) {
        if (error?.oauthError === "invalid_grant") {
          needsReauth = true;
          sources.google = { state: "needs_reauth", events: 0 };
        } else {
          errors.push("Google: Synchronisierung fehlgeschlagen.");
          sources.google = { state: "error", events: 0 };
        }
      }
    }
  }

  if (iAcc) {
    try {
      const snapshot = await fetchIcloudSnapshot(iAcc as IcloudAccount, timeMin, timeMax);
      const icloudEvents = snapshot.events;
      let taskIds = new Map<string, string>();
      try {
        if (snapshot.selectedCalendarCount > 0) {
          const sync = await syncIcloudTasks(user.id, icloudEvents, timeMin, timeMax);
          taskIds = sync.taskIds;
        }
      } catch {
        taskSyncError = "Kalendertermine werden angezeigt, konnten aber nicht mit Aufgaben & Fristen verknüpft werden. Bitte die Datenmigration ausführen.";
      }
      for (const event of icloudEvents) event.taskId = taskIds.get(event.id) || null;
      events.push(...icloudEvents);
      const state = snapshot.selectedCalendarCount === 0 ? "no_calendars" : icloudEvents.length ? "connected" : "empty";
      const syncedAt = new Date().toISOString();
      sources.icloud = {
        state,
        events: icloudEvents.length,
        calendars: snapshot.calendarCount,
        selectedCalendars: snapshot.selectedCalendarCount,
        lastSyncedAt: syncedAt
      };
      await admin.from("icloud_accounts").update({
        status: "connected",
        last_error: null,
        last_synced_at: syncedAt,
        updated_at: new Date().toISOString()
      }).eq("id", (iAcc as IcloudAccount).id);
    } catch (error) {
      const message = safeIcloudError(error);
      const authFailed = error instanceof IcloudAuthError;
      errors.push(`iCloud: ${message}`);
      sources.icloud = { state: authFailed ? "needs_reauth" : "error", events: 0, lastSyncedAt: (iAcc as IcloudAccount).last_synced_at || null };
      await admin.from("icloud_accounts").update({
        status: authFailed ? "needs_reauth" : "error",
        last_error: message,
        updated_at: new Date().toISOString()
      }).eq("id", (iAcc as IcloudAccount).id);
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  const email = (gAcc as GoogleAccount | null)?.email || (iAcc as IcloudAccount | null)?.apple_id || null;
  if (needsReauth && !iAcc) return NextResponse.json({ connected: true, needsReauth: true, events: [], sources });
  return NextResponse.json({
    connected: true,
    email,
    events,
    sources,
    taskSyncError,
    error: errors.length ? errors.join(" · ") : undefined
  });
}
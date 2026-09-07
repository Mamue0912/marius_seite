import type { CalendarEvent } from "./googleCalendar";
import { supabaseAdmin } from "./supabaseAdmin";

export interface CalendarTaskSyncResult {
  taskIds: Map<string, string>;
  synced: number;
  deleted: number;
}

type ExistingCalendarTask = {
  id: string;
  external_id: string;
  status: string | null;
};

function allDayInstant(value: string | null): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00.000Z` : null;
}

export function calendarEventTaskRecord(
  userId: string,
  event: CalendarEvent,
  existingStatus?: string | null
): Record<string, unknown> {
  const startsAt = event.allDay ? allDayInstant(event.start) : new Date(event.start).toISOString();
  const endsAt = event.allDay ? allDayInstant(event.end) : event.end ? new Date(event.end).toISOString() : null;
  if (!startsAt) throw new Error("Kalendertermin hat kein gültiges Startdatum.");
  return {
    user_id: userId,
    title: event.title || "(ohne Titel)",
    note: event.description || null,
    priority: "normal",
    due_at: startsAt,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: event.allDay,
    location: event.location || null,
    status: existingStatus || "offen",
    category: "Kalender",
    source: "icloud_calendar",
    calendar_name: event.calendar,
    external_id: event.id,
    linked_calendar_event_id: event.id,
    external_url: event.htmlLink || null,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

export function staleExternalIds(existing: Array<{ external_id: string }>, incoming: Iterable<string>): string[] {
  const seen = new Set(incoming);
  return existing.map((item) => item.external_id).filter((id) => !!id && !seen.has(id));
}

function chunks<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

// Spiegelt einen vollständig geladenen iCloud-Zeitraum in das gemeinsame
// Aufgaben-/Fristenmodell. Stabile external_id-Werte verhindern Duplikate.
export async function syncIcloudTasks(
  userId: string,
  events: CalendarEvent[],
  timeMin: string,
  timeMax: string
): Promise<CalendarTaskSyncResult> {
  const admin = supabaseAdmin();
  // Serientermine (tägliches/wöchentliches Training, feste Wochenrhythmen) sind
  // keine Aufgaben und keine Fristen. Sie bleiben im Kalender sichtbar, werden
  // hier aber nicht übernommen. Da ihre IDs damit nicht mehr im Eingang stehen,
  // räumt der Löschabgleich unten bereits angelegte Einträge selbsttätig weg.
  events = events.filter((event) => !event.recurring);
  const incomingIds = events.map((event) => event.id);
  const existingById = new Map<string, ExistingCalendarTask>();

  for (const batch of chunks(incomingIds)) {
    if (!batch.length) continue;
    const { data, error } = await admin.from("tasks")
      .select("id,external_id,status")
      .eq("user_id", userId)
      .eq("source", "icloud_calendar")
      .in("external_id", batch);
    if (error) throw new Error("Kalenderverknüpfungen konnten nicht gelesen werden.");
    for (const task of (data || []) as ExistingCalendarTask[]) existingById.set(task.external_id, task);
  }

  const records = events.map((event) => calendarEventTaskRecord(userId, event, existingById.get(event.id)?.status));
  for (const batch of chunks(records)) {
    if (!batch.length) continue;
    const { error } = await admin.from("tasks").upsert(batch, { onConflict: "user_id,source,external_id" });
    if (error) throw new Error("Kalendertermine konnten nicht mit Aufgaben & Fristen synchronisiert werden.");
  }

  const taskIds = new Map<string, string>();
  for (const batch of chunks(incomingIds)) {
    if (!batch.length) continue;
    const { data, error } = await admin.from("tasks")
      .select("id,external_id")
      .eq("user_id", userId)
      .eq("source", "icloud_calendar")
      .in("external_id", batch);
    if (error) throw new Error("Kalenderverknüpfungen konnten nicht bestätigt werden.");
    for (const task of data || []) taskIds.set(task.external_id, task.id);
  }

  const { data: previous, error: previousError } = await admin.from("tasks")
    .select("id,external_id")
    .eq("user_id", userId)
    .eq("source", "icloud_calendar")
    .gte("starts_at", new Date(timeMin).toISOString())
    .lt("starts_at", new Date(timeMax).toISOString());
  if (previousError) throw new Error("Vorherige Kalendertermine konnten nicht abgeglichen werden.");

  const stale = staleExternalIds((previous || []) as Array<{ external_id: string }>, incomingIds);
  let deleted = 0;
  for (const batch of chunks(stale)) {
    const { error, count } = await admin.from("tasks")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("source", "icloud_calendar")
      .in("external_id", batch);
    if (error) throw new Error("Gelöschte Kalendertermine konnten nicht abgeglichen werden.");
    deleted += count || 0;
  }

  return { taskIds, synced: events.length, deleted };
}
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

// Feiertage und Gedenktage sind Kalenderwissen, keine Aufgaben. Die Liste ist
// bewusst eng gehalten: Nur eindeutige Fälle werden automatisch aussortiert,
// damit nichts Wichtiges stillschweigend verschwindet.
const NON_TASK_TITLES = [
  "neujahr", "silvester", "heilige drei könige", "heilige drei koenige", "karfreitag",
  "ostersonntag", "ostermontag", "ostern", "tag der arbeit", "christi himmelfahrt",
  "pfingstsonntag", "pfingstmontag", "pfingsten", "fronleichnam", "mariä himmelfahrt",
  "maria himmelfahrt", "tag der deutschen einheit", "reformationstag", "allerheiligen",
  "buß- und bettag", "buss- und bettag", "heiligabend", "weihnachtstag", "weihnachten",
  "muttertag", "vatertag", "nikolaus", "halloween", "valentinstag",
  // Ferienzeiträume sind Zeitraum-Wissen, keine Aufgabe.
  "ferien", "feiertag", "brückentag", "brueckentag"
];

// Kalender, die grundsätzlich nur Hintergrund liefern (abonniert oder generiert).
const BACKGROUND_CALENDAR = /(feiertag|geburtstag|ferien|namenstag|holiday|birthday)/i;

// "ignoredHard" – eindeutig keine Aufgabe (Feiertage, Ferien, Geburtstage).
//                 Setzt sich immer durch, auch gegen einen alten Status.
// "ignoredSoft"  – standardmäßig keine Aufgabe, aber Ansichtssache. Serien
//                 gehören hierher: Ein wöchentliches Training ist keine
//                 Aufgabe, ein wöchentlicher Feedbackbogen dagegen schon.
//                 Holt der Nutzer so etwas zurück, bleibt es dauerhaft drin.
export type CalendarEventKind = "task" | "ignoredHard" | "ignoredSoft" | "skip";

// Einordnung eines Kalendertermins:
//   task    – wird als Aufgabe/Frist geführt
//   ignored – wird angelegt, aber als „Nicht als Aufgabe“ ausgeblendet. So
//             verschwindet nichts spurlos und lässt sich mit einem Klick
//             zurückholen, falls die Regel danebenlag.
//   skip    – erzeugt gar nichts (Einzelinstanzen einer Serie, sonst entstünde
//             pro Wiederholung ein neuer Eintrag).
export function classifyCalendarEvent(event: CalendarEvent): CalendarEventKind {
  // Einzelinstanzen einer Serie erzeugen gar nichts, sonst entstünde pro
  // Wiederholung ein Eintrag. Nur der Serien-Master wird geführt.
  if (event.recurring && event.recurrenceInstance) return "skip";
  if (event.calendar && BACKGROUND_CALENDAR.test(event.calendar)) return "ignoredHard";
  const title = (event.title || "").toLowerCase().trim();
  if (title && NON_TASK_TITLES.some((entry) => title.includes(entry))) return "ignoredHard";
  if (event.recurring) return "ignoredSoft";
  return "task";
}

export function isTaskWorthyEvent(event: CalendarEvent): boolean {
  return classifyCalendarEvent(event) === "task";
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
  // Nicht jeder Kalendereintrag ist eine Aufgabe oder Frist. Was die Regeln
  // aussortieren, wird trotzdem angelegt – nur als „Nicht als Aufgabe“
  // ausgeblendet. Damit verschwindet nichts spurlos und eine falsch
  // aussortierte Sache lässt sich mit einem Klick zurückholen.
  const forcedStatusById = new Map<string, string>();   // setzt sich immer durch
  const defaultStatusById = new Map<string, string>();  // nur beim ersten Anlegen
  events = events.filter((event) => {
    const kind = classifyCalendarEvent(event);
    if (kind === "skip") return false;
    if (kind === "ignoredHard") forcedStatusById.set(event.id, "ignoriert");
    if (kind === "ignoredSoft") defaultStatusById.set(event.id, "ignoriert");
    return true;
  });
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

  // Reihenfolge der Status: Eindeutiges (Feiertage, Ferien) setzt sich immer
  // durch – sonst blieben früher angelegte Einträge für immer in der Liste.
  // Sonst gewinnt der vorhandene Status, damit eine Entscheidung des Nutzers
  // hält (zurückgeholte Serie bleibt Aufgabe, ausgeblendeter Termin bleibt
  // ausgeblendet). Erst danach greift der Standard für neue Einträge.
  const records = events.map((event) =>
    calendarEventTaskRecord(
      userId,
      event,
      forcedStatusById.get(event.id) || existingById.get(event.id)?.status || defaultStatusById.get(event.id)
    )
  );
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
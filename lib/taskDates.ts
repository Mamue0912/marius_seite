export type TaskLike = { due_at?: string | null; status?: string };
export const TASK_BUCKETS = ["Überfällig", "Heute", "Diese Woche", "Später", "Ohne Datum", "Warten auf Rückmeldung", "Erledigt"];
// Calendar-day comparisons remain correct over daylight-saving transitions.
export function dayDistance(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T00:00:00") : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}
export function taskBucket(task: TaskLike, now = new Date()): string {
  if (task.status === "erledigt") return "Erledigt";
  if (task.status === "warten") return "Warten auf Rückmeldung";
  const days = dayDistance(task.due_at, now);
  if (days === null) return "Ohne Datum";
  return days < 0 ? "Überfällig" : days === 0 ? "Heute" : days <= 7 ? "Diese Woche" : "Später";
}

type DatedTaskLike = TaskLike & { title?: string | null };

function calendarDateKey(value: string, timeZone: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  const year = part("year"), month = part("month"), day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function isFeedbackFormTask(task: DatedTaskLike): boolean {
  return (task.title || "").toLocaleLowerCase("de").includes("feedbackbogen");
}

/** Vergangene Aufgaben bleiben aus den aktiven Cockpit-Ansichten. Aufgaben ohne Datum und Feedbackbögen bleiben sichtbar. */
export function keepCurrentTask(task: DatedTaskLike, now = new Date(), timeZone = "Europe/Berlin"): boolean {
  if (!task.due_at || isFeedbackFormTask(task)) return true;
  const due = calendarDateKey(task.due_at, timeZone);
  const today = calendarDateKey(now.toISOString(), timeZone);
  return !due || !today || due >= today;
}

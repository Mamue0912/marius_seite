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

export const TASK_PRIORITIES = ["niedrig", "normal", "hoch", "dringend"] as const;
// "ignoriert": ein importierter Kalendertermin, den der Nutzer ausdrücklich
// nicht als Aufgabe führen will. Der Eintrag bleibt erhalten (und damit
// umkehrbar), taucht aber nicht mehr in der Liste auf. Die Synchronisierung
// übernimmt vorhandene Status, deshalb überlebt die Entscheidung jeden Abgleich.
export const TASK_STATUSES = ["offen", "warten", "erledigt", "ignoriert"] as const;
export const TASK_SOURCES = ["manuell", "mail", "bewerbung", "apple", "apple_erinnerungen", "icloud_calendar"] as const;

export function taskPriorityRank(value: string | null | undefined): number {
  return value === "dringend" ? 4 : value === "hoch" ? 3 : value === "normal" ? 2 : value === "niedrig" ? 1 : 0;
}

export function validTaskPriority(value: unknown): value is (typeof TASK_PRIORITIES)[number] {
  return typeof value === "string" && TASK_PRIORITIES.includes(value as (typeof TASK_PRIORITIES)[number]);
}

export function validTaskStatus(value: unknown): value is (typeof TASK_STATUSES)[number] {
  return typeof value === "string" && TASK_STATUSES.includes(value as (typeof TASK_STATUSES)[number]);
}

export function validTaskSource(value: unknown): value is (typeof TASK_SOURCES)[number] {
  return typeof value === "string" && TASK_SOURCES.includes(value as (typeof TASK_SOURCES)[number]);
}

export function taskTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Bitte einen Aufgabentitel eingeben.");
  const title = value.trim();
  if (title.length > 500) throw new Error("Der Aufgabentitel ist zu lang.");
  return title;
}

export function taskNote(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Die Notiz ist ungültig.");
  const note = value.trim();
  if (note.length > 5000) throw new Error("Die Notiz ist zu lang.");
  return note || null;
}

export function taskDueDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Das Fälligkeitsdatum ist ungültig.");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Das Fälligkeitsdatum ist ungültig.");
  return date.toISOString();
}
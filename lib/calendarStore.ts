// Seitenübergreifender Kalender-Cache (Client). Bleibt dank Client-Navigation
// (<Link>) über Seitenwechsel hinweg erhalten. Ermöglicht Vorladen beim Hovern
// über „Kalender" und sofortige Anzeige beim Öffnen (stale-while-revalidate).

export interface CalEvent {
  id: string; title: string; start: string; end: string | null;
  allDay: boolean; location: string | null; calendar: string;
  color: string; textColor: string; htmlLink: string | null;
  description?: string | null; source?: "google" | "icloud"; taskId?: string | null;
}
export interface CalSourceState { state: "connected" | "empty" | "no_calendars" | "error" | "needs_reauth"; events?: number; calendars?: number; selectedCalendars?: number; lastSyncedAt?: string | null }
export interface CalResult { connected: boolean; needsReauth?: boolean; error?: string; taskSyncError?: string; email?: string | null; sources?: Record<string, CalSourceState> }

const store = { events: [] as CalEvent[], loaded: [] as Array<[number, number]>, email: null as string | null };
const inflight = new Map<string, Promise<CalResult>>();

export function calStore() { return store; }
export function calInvalidate() { store.loaded = []; }
export function calCovered(min: number, max: number) { return store.loaded.some(([a, b]) => a <= min && b >= max); }

function addInterval(min: number, max: number) {
  const list = [...store.loaded, [min, max] as [number, number]].sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const iv of list) { const last = merged[merged.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else merged.push([iv[0], iv[1]]); }
  store.loaded = merged;
}

// Lädt ein Zeitfenster und fügt es in den Store ein (dedupliziert per id).
// Gleichzeitige identische Anfragen werden zusammengefasst.
export function calFetchWindow(min: Date, max: Date): Promise<CalResult> {
  const key = min.toISOString() + "|" + max.toISOString();
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async (): Promise<CalResult> => {
    try {
      const q = new URLSearchParams({ timeMin: min.toISOString(), timeMax: max.toISOString() });
      const res = await fetch(`/api/calendar/events?${q.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return { connected: true, error: data.message || "Kalender konnte nicht geladen werden." };
      if (data.needsReauth) return { connected: true, needsReauth: true, sources: data.sources };
      if (!data.connected) return { connected: false };
      const winMin = min.getTime(), winMax = max.getTime();
      const incoming: CalEvent[] = data.events || [];
      const kept = store.events.filter((e) => { const t = new Date(e.start).getTime(); return isNaN(t) || t < winMin || t >= winMax; });
      const byId = new Map<string, CalEvent>();
      for (const e of kept) byId.set(e.id, e);
      for (const e of incoming) byId.set(e.id, e);
      store.events = Array.from(byId.values());
      // Teilweise geladene Termine bleiben sichtbar. Bei einem Fehler wird das
      // Fenster nicht als vollständig markiert, damit ein erneuter Versuch folgt.
      if (!data.error) addInterval(winMin, winMax);
      if (data.email) store.email = data.email;
      if (data.error) return { connected: true, error: data.error, taskSyncError: data.taskSyncError, email: data.email, sources: data.sources };
      return { connected: true, taskSyncError: data.taskSyncError, email: data.email, sources: data.sources };
    } catch (e) {
      return { connected: true, error: (e as Error).message };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// Monatsraster des aktuellen Monats ±1 Monat – zum Vorladen (Hover) und als
// Standardfenster beim Öffnen.
export function calDefaultWindow(): { grid: [number, number]; win: { min: Date; max: Date } } {
  const n = new Date();
  const first = new Date(n.getFullYear(), n.getMonth(), 1);
  const off = (first.getDay() + 6) % 7;
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - off); gridStart.setHours(0, 0, 0, 0);
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
  const min = new Date(gridStart); min.setMonth(min.getMonth() - 1); min.setDate(1); min.setHours(0, 0, 0, 0);
  const max = new Date(gridEnd); max.setMonth(max.getMonth() + 1); max.setDate(1); max.setHours(0, 0, 0, 0);
  return { grid: [gridStart.getTime(), gridEnd.getTime()], win: { min, max } };
}

// Beim Hovern über „Kalender": Standardfenster im Hintergrund vorladen.
export function calPrefetchDefault() {
  const { grid, win } = calDefaultWindow();
  if (!calCovered(grid[0], grid[1])) calFetchWindow(win.min, win.max);
}

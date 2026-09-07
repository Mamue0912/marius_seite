"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calStore, calCovered, calFetchWindow, calInvalidate, CalSourceState } from "@/lib/calendarStore";
import { requestJson } from "@/lib/http";

interface Ev {
  id: string; title: string; start: string; end: string | null;
  allDay: boolean; location: string | null; calendar: string;
  color: string; textColor: string; htmlLink: string | null;
  description?: string | null; source?: "google" | "icloud"; taskId?: string | null;
}
type View = "day" | "month" | "week" | "year" | "agenda";

const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MON_S = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function evDayKey(e: Ev): string {
  return e.allDay ? e.start.slice(0, 10) : ymd(new Date(e.start));
}
// Alle Tage, die ein Termin abdeckt (für mehrtägige Ereignisse). Bei
// ganztägigen Terminen ist Googles Enddatum exklusiv → letzter Tag = end − 1.
function dayKeysOf(e: Ev): string[] {
  const startKey = evDayKey(e);
  if (!e.end) return [startKey];
  let start: Date, end: Date;
  if (e.allDay) {
    start = new Date(e.start.slice(0, 10) + "T00:00:00");
    end = new Date(e.end.slice(0, 10) + "T00:00:00");
    end.setDate(end.getDate() - 1); // exklusives Ende → letzter belegter Tag
  } else {
    start = new Date(e.start); start.setHours(0, 0, 0, 0);
    const rawEnd = new Date(e.end);
    // Endet exakt um Mitternacht → dieser Tag zählt nicht mehr mit.
    if (rawEnd.getHours() === 0 && rawEnd.getMinutes() === 0 && rawEnd.getTime() > start.getTime()) rawEnd.setMinutes(-1);
    end = new Date(rawEnd); end.setHours(0, 0, 0, 0);
  }
  const keys: string[] = [];
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 400) { keys.push(ymd(cur)); cur.setDate(cur.getDate() + 1); guard++; }
  return keys.length ? keys : [startKey];
}
function timeLabel(e: Ev): string {
  if (e.allDay) return "ganztägig";
  return new Date(e.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
// Montag der Woche, in der d liegt.
function mondayOf(d: Date): Date {
  const off = (d.getDay() + 6) % 7;
  const m = new Date(d); m.setDate(d.getDate() - off); m.setHours(0, 0, 0, 0); return m;
}

export default function CalendarView({ initialEmail, hasGoogle = false }: { initialEmail?: string | null; hasGoogle?: boolean }) {
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [weekAnchor, setWeekAnchor] = useState(() => mondayOf(new Date()));
  // Aus dem seitenübergreifenden Cache initialisieren → sofortige Anzeige,
  // wenn beim Hovern über „Kalender" bereits vorgeladen wurde.
  const [events, setEvents] = useState<Ev[]>(() => calStore().events as Ev[]);
  const [loading, setLoading] = useState(() => calStore().events.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [view, setView] = useState<View>("week");
  const [selected, setSelected] = useState<string>(() => ymd(new Date()));
  const [disconnecting, setDisconnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sources, setSources] = useState<Record<string, CalSourceState>>({});
  const [taskSyncError, setTaskSyncError] = useState<string | null>(null);

  async function disconnect() {
    if (disconnecting || !confirm("Google-Kalender wirklich trennen?")) return;
    setDisconnecting(true);
    try { await requestJson("/api/auth/google/disconnect", { method: "POST" }); window.location.href = "/calendar"; }
    catch (caught) { setError((caught as Error).message || "Google-Kalender konnte nicht getrennt werden."); setDisconnecting(false); }
  }

  // Zu ladendes Zeitfenster je nach Ansicht.
  const range = useMemo(() => {
    if (view === "year") {
      return { min: new Date(cursor.getFullYear(), 0, 1), max: new Date(cursor.getFullYear() + 1, 0, 1) };
    }
    if (view === "day") {
      const min = new Date(selected + "T00:00:00"); const max = new Date(min); max.setDate(max.getDate() + 1);
      return { min, max };
    }
    if (view === "week") {
      const min = new Date(weekAnchor); const max = new Date(weekAnchor); max.setDate(max.getDate() + 7);
      return { min, max };
    }
    if (view === "agenda") {
      const min = new Date(); min.setHours(0, 0, 0, 0);
      const max = new Date(min); max.setDate(max.getDate() + 60);
      return { min, max };
    }
    // month: 6-Wochen-Raster
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = mondayOf(first);
    const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
    return { min: gridStart, max: gridEnd };
  }, [view, cursor, weekAnchor, selected]);

  // Bewusst breiteres Fenster laden als sichtbar (±1 Monat bzw. ganzes Jahr),
  // damit Blättern/Umschalten meist sofort aus dem gemeinsamen Cache kommt.
  function windowFor(): { min: Date; max: Date } {
    if (view === "year") return { min: new Date(cursor.getFullYear(), 0, 1), max: new Date(cursor.getFullYear() + 1, 0, 1) };
    const min = new Date(range.min); min.setMonth(min.getMonth() - 1); min.setDate(1); min.setHours(0, 0, 0, 0);
    const max = new Date(range.max); max.setMonth(max.getMonth() + 1); max.setDate(1); max.setHours(0, 0, 0, 0);
    return { min, max };
  }

  const load = useCallback(async (force = false) => {
    const visMin = range.min.getTime(), visMax = range.max.getTime();
    // Bereits im Cache → sofort anzeigen, kein Netzwerk, kein Spinner.
    if (!force && calCovered(visMin, visMax)) { setEvents(calStore().events as Ev[]); setLoading(false); return; }
    const win = windowFor();
    // Stale-while-revalidate: vorhandene Termine sichtbar lassen; Spinner nur,
    // wenn noch gar nichts geladen ist.
    if (!calStore().events.length) setLoading(true);
    setError(null); setNeedsReauth(false);
    const r = await calFetchWindow(win.min, win.max);
    if (r.sources) setSources(r.sources);
    setTaskSyncError(r.taskSyncError || null);
    if (r.needsReauth) setNeedsReauth(true);
    else if (r.error) setError(r.error);
    setEvents(calStore().events as Ev[]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, view, cursor]);

  useEffect(() => { void load(); }, [load]);

  async function refresh() {
    setRefreshing(true);
    calInvalidate();
    try { await load(true); }
    finally { setRefreshing(false); }
  }

  const byDay = useMemo(() => {
    const m: Record<string, Ev[]> = {};
    for (const e of events) for (const k of dayKeysOf(e)) { (m[k] ||= []).push(e); }
    // Innerhalb eines Tages: ganztägige/mehrtägige zuerst, dann nach Uhrzeit.
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
    return m;
  }, [events]);

  const todayKey = ymd(new Date());

  // Titel + Navigation je nach Ansicht.
  function shift(delta: number) {
    if (view === "year") setCursor((c) => new Date(c.getFullYear() + delta, 0, 1));
    else if (view === "day") setSelected((value) => { const n = new Date(value + "T00:00:00"); n.setDate(n.getDate() + delta); return ymd(n); });
    else if (view === "week") setWeekAnchor((w) => { const n = new Date(w); n.setDate(n.getDate() + delta * 7); return n; });
    else setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }
  function goToday() {
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
    setWeekAnchor(mondayOf(n)); setSelected(ymd(n));
  }
  const icloudLastSync = sources.icloud?.lastSyncedAt
    ? new Date(sources.icloud.lastSyncedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
    : null;
  const title = view === "year" ? String(cursor.getFullYear())
    : view === "day" ? new Date(selected + "T00:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : view === "week"
      ? (() => { const e = new Date(weekAnchor); e.setDate(e.getDate() + 6); return `${weekAnchor.getDate()}.–${e.getDate()}. ${MON[e.getMonth()]} ${e.getFullYear()}`; })()
      : `${MON[cursor.getMonth()]} ${cursor.getFullYear()}`;

  return (
    <div className="cal">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="cal-btn" onClick={() => shift(-1)} aria-label="Zurück">‹</button>
          <div className="cal-title">{title}</div>
          <button className="cal-btn" onClick={() => shift(1)} aria-label="Weiter">›</button>
          <button className="cal-today" onClick={goToday}>Heute</button>
        </div>
        <div className="cal-right">
          {initialEmail && <span className="cal-acct">{initialEmail}</span>}
          <div className="cal-viewswitch">
            {(["day", "week", "month", "year", "agenda"] as View[]).map((v) => (
              <button key={v} className={"cal-vbtn" + (view === v ? " on" : "")} onClick={() => setView(v)}>
                {v === "day" ? "Tag" : v === "week" ? "Woche" : v === "month" ? "Monat" : v === "year" ? "Jahr" : "Agenda"}
              </button>
            ))}
          </div>
          <button type="button" className="cal-today" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Aktualisiert…" : "Aktualisieren"}</button>
          {hasGoogle && <button type="button" className="cal-disc" onClick={disconnect} disabled={disconnecting}>{disconnecting ? "…" : "Google trennen"}</button>}
        </div>
      </div>

      {loading && initialEmail && <div className="cal-note">Verbindung wird geprüft und Termine werden synchronisiert…</div>}
      {needsReauth && <div className="cal-note bad">Die Google-Verbindung ist abgelaufen. <a href="/api/auth/google">Erneut verbinden</a></div>}
      {error && <div className="cal-note bad">Kalender konnte nicht geladen werden: {error}</div>}
      {sources.icloud?.state === "connected" && <div className="cal-note ok">iCloud erfolgreich synchronisiert · {sources.icloud.events || 0} Termine aus {sources.icloud.selectedCalendars || 0} Kalendern im geladenen Zeitraum{icloudLastSync ? ` · Stand ${icloudLastSync}` : ""}.</div>}
      {sources.icloud?.state === "empty" && <div className="cal-note">iCloud ist verbunden. Im gewählten Zeitraum wurden keine Termine gefunden{icloudLastSync ? ` · Stand ${icloudLastSync}` : ""}.</div>}
      {sources.icloud?.state === "no_calendars" && <div className="cal-note bad">iCloud ist verbunden, aber es ist kein Kalender für die Synchronisierung ausgewählt.</div>}
      {!!sources.icloud?.skippedCalendars?.length && <div className="cal-note">Von Apple gesperrt und daher übersprungen: {sources.icloud.skippedCalendars.join(", ")}. Das betrifft meist Geburtstage und abonnierte Kalender.</div>}
      {sources.icloud?.state === "needs_reauth" && <div className="cal-note bad">Die iCloud-Zugangsdaten oder Berechtigung sind nicht mehr gültig. Bitte iCloud unten erneut verbinden.</div>}
      {taskSyncError && <div className="cal-note bad">{taskSyncError}</div>}

      {view === "month" && <MonthView cursor={cursor} byDay={byDay} todayKey={todayKey} selected={selected} setSelected={setSelected} loading={loading} />}
      {view === "day" && <TimelineView anchor={new Date(selected + "T00:00:00")} dayCount={1} byDay={byDay} todayKey={todayKey} loading={loading} />}
      {view === "week" && <TimelineView anchor={weekAnchor} dayCount={7} byDay={byDay} todayKey={todayKey} loading={loading} />}
      {view === "year" && <YearView year={cursor.getFullYear()} byDay={byDay} todayKey={todayKey} onPick={(m: number) => { setCursor(new Date(cursor.getFullYear(), m, 1)); setView("month"); }} />}
      {view === "agenda" && <AgendaView events={events} todayKey={todayKey} loading={loading} />}
    </div>
  );
}

function MonthView({ cursor, byDay, todayKey, selected, setSelected, loading }: any) {
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const off = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(first.getDate() - off);
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(d.getDate() + i); out.push(d); }
    return out;
  }, [cursor]);
  const selEvents: Ev[] = byDay[selected] || [];
  return (
    <div className="cal-grid-wrap">
      <div className="cal-month-board">
        <div className="cal-wd">{WD.map((w) => <div key={w} className="cal-wdc">{w}</div>)}</div>
        <div className="cal-grid">
          {cells.map((d) => {
            const k = ymd(d);
            const inMonth = d.getMonth() === cursor.getMonth();
            const evs: Ev[] = byDay[k] || [];
            return (
              <button key={k} className={"cal-cell" + (inMonth ? "" : " out") + (k === todayKey ? " today" : "") + (k === selected ? " sel" : "")} onClick={() => setSelected(k)}>
                <span className="cal-dnum">{d.getDate()}</span>
                <span className="cal-dots">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e.id} className="cal-chip" style={{ background: e.color, color: e.textColor }} title={e.title}>
                      {e.allDay ? "" : timeLabel(e) + " "}{e.title}
                    </span>
                  ))}
                  {evs.length > 3 && <span className="cal-more">+{evs.length - 3}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <aside className="cal-day" aria-label="Termine des ausgewählten Tages">
        <div className="cal-day-kicker">Ausgewählter Tag</div>
        <div className="cal-day-h">{new Date(selected + "T00:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" })}</div>
        {loading ? <div className="cal-empty">lädt…</div>
          : selEvents.length === 0 ? <div className="cal-empty">Keine Termine an diesem Tag.</div>
          : selEvents.map((e) => <EventRow key={e.id} e={e} />)}
      </aside>
    </div>
  );
}

const HOUR_MIN = 18, HOUR_MAX = 160, HOUR_DEFAULT = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Minuten, die ein Termin an einem bestimmten Tag belegt. Mehrtägige Termine
// werden auf den Tag beschnitten; sehr kurze bekommen eine Mindestdauer, damit
// sie im Raster sichtbar bleiben.
export function daySlot(e: Ev, dayKey: string): { from: number; to: number } | null {
  if (e.allDay) return null;
  const dayStart = new Date(dayKey + "T00:00:00");
  if (!Number.isFinite(dayStart.getTime())) return null;
  const nextDay = new Date(dayStart); nextDay.setDate(nextDay.getDate() + 1);
  const start = new Date(e.start);
  if (!Number.isFinite(start.getTime())) return null;
  const parsedEnd = e.end ? new Date(e.end) : new Date(start.getTime() + 3600000);
  const end = Number.isFinite(parsedEnd.getTime()) ? parsedEnd : new Date(start.getTime() + 3600000);
  if (end <= dayStart || start >= nextDay) return null;
  const from = start <= dayStart ? 0 : start.getHours() * 60 + start.getMinutes() + start.getSeconds() / 60;
  const to = end >= nextDay ? 1440 : end.getHours() * 60 + end.getMinutes() + end.getSeconds() / 60;
  return { from: Math.max(0, from), to: Math.min(1440, Math.max(to, from + 15)) };
}

type Slot = { e: Ev; from: number; to: number };
type Packed = Slot & { depth: number };

const MAX_DEPTH = 4;

// Überlappende Termine werden übereinander gelegt statt nebeneinander: Der
// längere Termin liegt hinten und behält seine volle Breite, der kürzere liegt
// darüber und ist leicht eingerückt. So bleibt der lange Termin als Zeitraum
// sichtbar und der kurze ist trotzdem klar erkennbar.
export function packDay(items: Slot[]): Packed[] {
  // Längster zuerst – dadurch liegen kürzere Termine automatisch weiter oben.
  const sorted = [...items].sort((a, b) => (b.to - b.from) - (a.to - a.from) || a.from - b.from);
  const placed: Packed[] = [];
  for (const item of sorted) {
    // Einrückung ergibt sich aus der Zahl der bereits liegenden Termine, die
    // sich zeitlich mit diesem überschneiden.
    const depth = placed.filter((p) => p.from < item.to && item.from < p.to).length;
    placed.push({ ...item, depth: Math.min(depth, MAX_DEPTH) });
  }
  return placed;
}

function EventBlock({ p, hourHeight }: { p: Packed; hourHeight: number }) {
  const e = p.e;
  const height = Math.max(15, ((p.to - p.from) / 60) * hourHeight - 2);
  // Einrückung je Überlappungsebene: Der darunterliegende, längere Termin
  // bleibt am linken Rand sichtbar.
  const inset = p.depth * 14;
  const style: React.CSSProperties = {
    top: (p.from / 60) * hourHeight,
    height,
    left: inset + 2,
    width: `calc(100% - ${inset + 6}px)`,
    // Leicht durchscheinend, damit die Stundenlinien und ein darunterliegender
    // Termin sichtbar bleiben.
    background: `color-mix(in srgb, ${e.color} 74%, transparent)`,
    borderColor: `color-mix(in srgb, ${e.color} 92%, transparent)`,
    color: e.textColor,
    zIndex: 2 + p.depth
  };
  const from = new Date(e.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const to = e.end ? new Date(e.end).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "";
  const label = `${from}${to ? "–" + to : ""} · ${e.title}${e.location ? " · " + e.location : ""}`;
  const inner = (
    <>
      <span className="cal-tgev-t">{from}</span>
      <span className="cal-tgev-s">{e.title}</span>
    </>
  );
  const href = e.htmlLink || (e.taskId ? "/tasks?open=" + encodeURIComponent(e.taskId) : null);
  return href
    ? <a className="cal-tgev" style={style} title={label} href={href} target={e.htmlLink ? "_blank" : undefined} rel={e.htmlLink ? "noopener noreferrer" : undefined}>{inner}</a>
    : <div className="cal-tgev" style={style} title={label}>{inner}</div>;
}

export function TimelineView({ anchor, dayCount, byDay, todayKey, loading }: any) {
  const anchorTime = anchor.getTime();
  const days = useMemo(() => {
    const out: Date[] = [];
    const base = new Date(anchorTime);
    for (let i = 0; i < dayCount; i++) { const d = new Date(anchorTime); d.setDate(base.getDate() + i); out.push(d); }
    return out;
  }, [anchorTime, dayCount]);

  const [hourHeight, setHourHeight] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem("calHourHeight"));
      if (stored >= HOUR_MIN && stored <= HOUR_MAX) return stored;
    } catch { /* Speicherzugriff kann blockiert sein */ }
    return HOUR_DEFAULT;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const hhRef = useRef(hourHeight);
  // Sobald der Nutzer selbst scrollt, wird die Startposition nicht mehr gesetzt.
  const userScrolled = useRef(false);
  const placedFor = useRef<number | null>(null);
  useEffect(() => {
    hhRef.current = hourHeight;
    try { localStorage.setItem("calHourHeight", String(hourHeight)); } catch { /* egal */ }
  }, [hourHeight]);

  // Strg/Cmd + Mausrad skaliert die Zeitachse; der Punkt unter dem Zeiger
  // bleibt dabei stehen. Das blanke Mausrad scrollt ganz normal, damit die
  // Stunden oberhalb des Sichtbereichs erreichbar bleiben. Der Listener wird
  // bewusst selbst registriert (passive: false), weil React Rad-Ereignisse
  // sonst passiv behandelt und preventDefault wirkungslos bliebe.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      // Über dem Kalender skaliert das Mausrad die Zeitachse. Neben dem
      // Kalender scrollt die Seite wie gewohnt – dieser Listener hängt nur am
      // Raster, außerhalb wird nichts abgefangen.
      // Shift + Rad bleibt als Weg zum Scrollen innerhalb des Rasters.
      if (ev.shiftKey) { userScrolled.current = true; return; }
      ev.preventDefault();
      const h = hhRef.current;
      const next = Math.min(HOUR_MAX, Math.max(HOUR_MIN, Math.round(ev.deltaY < 0 ? h * 1.12 : h / 1.12)));
      if (next === h) return;
      const y = ev.clientY - el.getBoundingClientRect().top;
      const minutes = ((el.scrollTop + y) / h) * 60;
      setHourHeight(next);
      requestAnimationFrame(() => { el.scrollTop = Math.max(0, (minutes / 60) * next - y); });
    };
    // Auch Ziehen an der Bildlaufleiste oder Tastaturscrollen zählt als
    // eigene Entscheidung des Nutzers.
    const markManual = () => { userScrolled.current = true; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", markManual, { passive: true });
    el.addEventListener("keydown", markManual);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", markManual);
      el.removeEventListener("keydown", markManual);
    };
  }, []);

  // Startposition: der Tag beginnt sichtbar um 6 Uhr. Liegt in der Woche ein
  // Termin früher, wird so weit nach oben gerückt, dass auch dieser zu sehen
  // ist – nichts soll oberhalb des Sichtbereichs verborgen bleiben.
  const earliestMin = useMemo(() => {
    let earliest = 6 * 60;
    for (const d of days) {
      const k = ymd(d);
      for (const e of ((byDay[k] || []) as Ev[])) {
        const slot = daySlot(e, k);
        if (slot && slot.from < earliest) earliest = slot.from;
      }
    }
    return Math.max(0, earliest);
  }, [days, byDay]);

  // Ein Durchlauf nach dem ersten Layout: erst dann hat der Scrollbereich eine
  // Höhe und lässt sich überhaupt positionieren.
  const [layoutReady, setLayoutReady] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setLayoutReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Beim Wochenwechsel wird die Startposition neu bestimmt.
  useEffect(() => { userScrolled.current = false; placedFor.current = null; }, [anchorTime]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrolled.current || placedFor.current === earliestMin) return;
    // Etwas Luft über dem frühesten Eintrag, damit er nicht am Rand klebt.
    const target = Math.max(0, (earliestMin / 60) * hourHeight - 8);
    // Vor dem ersten Layout ist der Bereich noch nicht scrollbar; ein Setzen
    // von scrollTop würde dann auf 0 zurückfallen und – weil die Position als
    // erledigt vermerkt wäre – nie wiederholt. Deshalb wird erst nach dem
    // Layout gesetzt und nur bei tatsächlichem Erfolg vermerkt.
    const apply = () => {
      if (!el || userScrolled.current) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 2) placedFor.current = earliestMin;
    };
    apply();
    const raf1 = requestAnimationFrame(() => { apply(); });
    const raf2 = requestAnimationFrame(() => { apply(); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [earliestMin, hourHeight, layoutReady]);

  const [nowMin, setNowMin] = useState(() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); });
  useEffect(() => {
    const t = setInterval(() => { const n = new Date(); setNowMin(n.getHours() * 60 + n.getMinutes()); }, 60000);
    return () => clearInterval(t);
  }, []);

  const hasAllDay = days.some((d) => ((byDay[ymd(d)] || []) as Ev[]).some((e) => e.allDay));

  const hasEarly = earliestMin < 6 * 60;
  const gridStyle = { "--cal-days": dayCount } as React.CSSProperties;

  return (
    <div className={"cal-tg" + (dayCount === 1 ? " day" : "")} style={gridStyle}>
      <div className="cal-tg-top">
        <div className="cal-tg-gutter" />
        {days.map((d) => {
          const k = ymd(d);
          return (
            <div key={k} className={"cal-tg-head" + (k === todayKey ? " today" : "")}>
              <span className="cal-wcol-wd">{WD[(d.getDay() + 6) % 7]}</span>
              <span className="cal-wcol-d">{d.getDate()}</span>
            </div>
          );
        })}
      </div>

      {hasAllDay && (
        <div className="cal-tg-allday">
          <div className="cal-tg-gutter"><span>ganztägig</span></div>
          {days.map((d) => {
            const k = ymd(d);
            const evs = ((byDay[k] || []) as Ev[]).filter((e) => e.allDay);
            return (
              <div key={k} className="cal-tg-adcol">
                {evs.map((e) => (
                  e.htmlLink || e.taskId ? <a key={e.id} className="cal-tg-adev" style={{ background: e.color, color: e.textColor }} title={e.title} href={e.htmlLink || ("/tasks?open=" + encodeURIComponent(e.taskId!))} target={e.htmlLink ? "_blank" : undefined} rel={e.htmlLink ? "noopener noreferrer" : undefined}>{e.title}</a> : <span key={e.id} className="cal-tg-adev" style={{ background: e.color, color: e.textColor }} title={e.title}>{e.title}</span>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="cal-tg-scroll" ref={scrollRef}>
        <div className="cal-tg-body" style={{ height: 24 * hourHeight }}>
          <div className="cal-tg-axis">
            {HOURS.map((h) => (
              <div key={h} className="cal-tg-hour" style={{ height: hourHeight }}>
                <span>{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>
          {days.map((d) => {
            const k = ymd(d);
            const slots = ((byDay[k] || []) as Ev[])
              .map((e) => { const s = daySlot(e, k); return s ? { e, from: s.from, to: s.to } : null; })
              .filter((x): x is Slot => x !== null);
            const packed = packDay(slots);
            return (
              <div key={k} className={"cal-tg-col" + (k === todayKey ? " today" : "")}>
                {HOURS.map((h) => <div key={h} className="cal-tg-line" style={{ top: h * hourHeight }} />)}
                {k === todayKey && <div className="cal-tg-now" style={{ top: (nowMin / 60) * hourHeight }} />}
                {!loading && packed.map((p) => <EventBlock key={p.e.id} p={p} hourHeight={hourHeight} />)}
              </div>
            );
          })}
        </div>
      </div>

      <div className="cal-tg-hint">
        <span>{hasEarly ? "Ein Termin beginnt vor 06:00 Uhr; die Nachtstunden wurden automatisch eingeblendet." : "Standardzeitraum 06:00–24:00 Uhr"}</span>
        <button type="button" className="cal-night-toggle" onClick={() => { userScrolled.current = true; if (scrollRef.current) scrollRef.current.scrollTop = 0; }}>Nacht zeigen</button>
        <button type="button" className="cal-night-toggle" onClick={() => { userScrolled.current = true; if (scrollRef.current) scrollRef.current.scrollTop = 6 * hourHeight; }}>Ab 06:00</button>
        <span className="cal-tg-zoom">
          <button type="button" onClick={() => setHourHeight((h) => Math.max(HOUR_MIN, Math.round(h / 1.25)))} aria-label="Zeitskala verkleinern">−</button>
          <button type="button" onClick={() => setHourHeight(HOUR_DEFAULT)}>Standard</button>
          <button type="button" onClick={() => setHourHeight((h) => Math.min(HOUR_MAX, Math.round(h * 1.25)))} aria-label="Zeitskala vergrößern">+</button>
        </span>
      </div>
    </div>
  );
}

function YearView({ year, byDay, todayKey, onPick }: any) {
  return (
    <div className="cal-year">
      {MON_S.map((mLabel, m) => {
        const first = new Date(year, m, 1);
        const off = (first.getDay() + 6) % 7;
        const start = new Date(first); start.setDate(first.getDate() - off);
        const cells: Date[] = [];
        for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(d); }
        return (
          <button key={m} className="cal-ymonth" onClick={() => onPick(m)}>
            <div className="cal-ymonth-h">{mLabel}</div>
            <div className="cal-ywd">{WD.map((w) => <span key={w}>{w[0]}</span>)}</div>
            <div className="cal-ygrid">
              {cells.map((d, i) => {
                const k = ymd(d);
                const inMonth = d.getMonth() === m;
                const has = !!byDay[k]?.length;
                const dot = has ? byDay[k][0].color : null;
                return (
                  <span key={i} className={"cal-yd" + (inMonth ? "" : " out") + (k === todayKey ? " today" : "")}>
                    {d.getDate()}
                    {dot && inMonth && <span className="cal-ydot" style={{ background: dot }} />}
                  </span>
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AgendaView({ events, todayKey, loading }: any) {
  const groups = useMemo(() => {
    // Termine ab heute; laufende mehrtägige Ereignisse unter dem ersten Tag ≥ heute.
    const withDay = events
      .map((e: Ev) => ({ e, day: dayKeysOf(e).find((k) => k >= todayKey) }))
      .filter((x: { e: Ev; day?: string }) => !!x.day) as { e: Ev; day: string }[];
    withDay.sort((a, b) => a.day.localeCompare(b.day) || a.e.start.localeCompare(b.e.start));
    const g: { day: string; items: Ev[] }[] = [];
    for (const { e, day } of withDay) { const f = g.find((x) => x.day === day); if (f) f.items.push(e); else g.push({ day, items: [e] }); }
    return g;
  }, [events, todayKey]);
  if (loading) return <div className="cal-empty">lädt…</div>;
  if (groups.length === 0) return <div className="cal-empty">Keine anstehenden Termine in diesem Zeitraum.</div>;
  return (
    <div className="cal-agenda">
      {groups.map((g) => (
        <div key={g.day} className="cal-agroup">
          <div className="cal-aday">{new Date(g.day + "T00:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short" })}</div>
          <div>{g.items.map((e) => <EventRow key={e.id} e={e} />)}</div>
        </div>
      ))}
    </div>
  );
}

function EventRow({ e }: { e: Ev }) {
  const body = (
    <>
      <span className="cal-ev-bar" style={{ background: e.color }} />
      <span className="cal-ev-time">{timeLabel(e)}</span>
      <span className="cal-ev-main">
        <span className="cal-ev-title">{e.title}</span>
        <span className="cal-ev-meta">{e.calendar}{e.location ? " · " + e.location : ""}</span>
      </span>
    </>
  );
  if (e.htmlLink) return <a className="cal-ev" href={e.htmlLink} target="_blank" rel="noopener noreferrer">{body}</a>;
  if (e.taskId) return <a className="cal-ev" href={`/tasks?open=${encodeURIComponent(e.taskId)}`}>{body}</a>;
  return <div className="cal-ev">{body}</div>;
}

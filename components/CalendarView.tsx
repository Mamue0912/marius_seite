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
type Packed = Slot & { depth: number; column: number; columns: number };

function overlaps(a: Slot, b: Slot): boolean {
  return a.from < b.to && b.from < a.to;
}
function strictlyContains(outer: Slot, inner: Slot): boolean {
  return outer.from <= inner.from && outer.to >= inner.to
    && (outer.from < inner.from || outer.to > inner.to);
}
function partialOverlap(a: Slot, b: Slot): boolean {
  return overlaps(a, b) && !strictlyContains(a, b) && !strictlyContains(b, a);
}

// Teilweise Überschneidungen erhalten getrennte Spalten. Umschließt ein Termin
// den anderen vollständig, bleiben beide in derselben Spalte und liegen
// eingerückt übereinander.
export function packDay(items: Slot[]): Packed[] {
  const sorted = [...items].sort((a, b) => a.from - b.from || b.to - a.to);
  const column = new Map<Slot, number>();
  const placed: Slot[] = [];

  for (const item of sorted) {
    let candidate = 0;
    while (placed.some((other) => column.get(other) === candidate && partialOverlap(other, item))) candidate++;
    column.set(item, candidate);
    placed.push(item);
  }

  const neighbours = new Map<Slot, Slot[]>(items.map((item) => [item, []]));
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (!partialOverlap(items[a], items[b])) continue;
      neighbours.get(items[a])!.push(items[b]);
      neighbours.get(items[b])!.push(items[a]);
    }
  }

  const columns = new Map<Slot, number>();
  const seen = new Set<Slot>();
  for (const item of items) {
    if (seen.has(item)) continue;
    const component: Slot[] = [];
    const queue = [item];
    seen.add(item);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of neighbours.get(current) || []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    const count = Math.max(1, ...component.map((entry) => (column.get(entry) || 0) + 1));
    for (const entry of component) columns.set(entry, count);
  }

  return sorted.map((item) => ({
    ...item,
    depth: Math.min(items.filter((other) => other !== item && strictlyContains(other, item)).length, 4),
    column: column.get(item) || 0,
    columns: columns.get(item) || 1
  }));
}

function EventBlock({ p, hourHeight, startMinute }: { p: Packed; hourHeight: number; startMinute: number }) {
  const e = p.e;
  const visibleFrom = Math.max(p.from, startMinute);
  const visibleTo = Math.min(p.to, 24 * 60);
  if (visibleTo <= visibleFrom) return null;
  const height = Math.max(20, ((visibleTo - visibleFrom) / 60) * hourHeight - 2);
  const compact = height < 32;
  const laneWidth = 100 / p.columns;
  const inset = p.depth * 10;
  const style: React.CSSProperties = {
    top: ((visibleFrom - startMinute) / 60) * hourHeight,
    height,
    left: `calc(${laneWidth * p.column}% + ${inset + 2}px)`,
    width: `calc(${laneWidth}% - ${inset + 5}px)`,
    background: `color-mix(in srgb, ${e.color} 82%, var(--surface))`,
    borderColor: `color-mix(in srgb, ${e.color} 94%, transparent)`,
    color: e.textColor,
    zIndex: 2 + p.depth
  };
  const from = new Date(e.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const to = e.end ? new Date(e.end).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "";
  const label = `${from}${to ? "–" + to : ""} · ${e.title}${e.location ? " · " + e.location : ""}`;
  const inner = compact ? (
    <>
      <span className="cal-tgev-s">{e.title}</span>
      <span className="cal-tgev-t">{from}</span>
    </>
  ) : (
    <>
      <span className="cal-tgev-t">{from}</span>
      <span className="cal-tgev-s">{e.title}</span>
    </>
  );
  const href = e.htmlLink || (e.taskId ? "/tasks?open=" + encodeURIComponent(e.taskId) : null);
  const className = "cal-tgev" + (compact ? " compact" : "");
  return href
    ? <a className={className} style={style} title={label} href={href} target={e.htmlLink ? "_blank" : undefined} rel={e.htmlLink ? "noopener noreferrer" : undefined}>{inner}</a>
    : <div className={className} style={style} title={label}>{inner}</div>;
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
  const [startHour, setStartHour] = useState<0 | 6>(6);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hhRef = useRef(hourHeight);
  const startHourRef = useRef(startHour);

  useEffect(() => {
    hhRef.current = hourHeight;
    try { localStorage.setItem("calHourHeight", String(hourHeight)); } catch { /* egal */ }
  }, [hourHeight]);
  useEffect(() => { startHourRef.current = startHour; }, [startHour]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (ev.shiftKey) return;
      ev.preventDefault();
      const h = hhRef.current;
      const next = Math.min(HOUR_MAX, Math.max(HOUR_MIN, Math.round(ev.deltaY < 0 ? h * 1.12 : h / 1.12)));
      if (next === h) return;
      const y = ev.clientY - el.getBoundingClientRect().top;
      const startMinutes = startHourRef.current * 60;
      const minutes = startMinutes + ((el.scrollTop + y) / h) * 60;
      setHourHeight(next);
      requestAnimationFrame(() => { el.scrollTop = Math.max(0, ((minutes - startMinutes) / 60) * next - y); });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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

  const [nowMin, setNowMin] = useState(() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); });
  useEffect(() => {
    const t = setInterval(() => { const n = new Date(); setNowMin(n.getHours() * 60 + n.getMinutes()); }, 60000);
    return () => clearInterval(t);
  }, []);

  const hasAllDay = days.some((d) => ((byDay[ymd(d)] || []) as Ev[]).some((e) => e.allDay));
  const hasEarly = earliestMin < 6 * 60;
  const startMinute = startHour * 60;
  const visibleHours = HOURS.slice(startHour);
  const gridStyle = { "--cal-days": dayCount } as React.CSSProperties;
  const setVisibleStart = (hour: 0 | 6) => {
    setStartHour(hour);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; });
  };

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
        <div className="cal-tg-body" style={{ height: (24 - startHour) * hourHeight }}>
          <div className="cal-tg-axis">
            {visibleHours.map((h) => (
              <div key={h} className="cal-tg-hour" style={{ height: hourHeight }}>
                <span>{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>
          {days.map((d) => {
            const k = ymd(d);
            const slots = ((byDay[k] || []) as Ev[])
              .map((e) => { const s = daySlot(e, k); return s && s.to > startMinute ? { e, from: s.from, to: s.to } : null; })
              .filter((x): x is Slot => x !== null);
            const packed = packDay(slots);
            return (
              <div key={k} className={"cal-tg-col" + (k === todayKey ? " today" : "")}>
                {visibleHours.map((h) => <div key={h} className="cal-tg-line" style={{ top: (h - startHour) * hourHeight }} />)}
                {k === todayKey && nowMin >= startMinute && <div className="cal-tg-now" style={{ top: ((nowMin - startMinute) / 60) * hourHeight }} />}
                {!loading && packed.map((p) => <EventBlock key={p.e.id} p={p} hourHeight={hourHeight} startMinute={startMinute} />)}
              </div>
            );
          })}
        </div>
      </div>

      <div className="cal-tg-hint">
        <span>{startHour === 0 ? "Nachtstunden 00:00–24:00 Uhr sichtbar." : hasEarly ? "Ein Termin beginnt vor 06:00 Uhr. Über „Nacht zeigen“ bleibt er erreichbar." : "Sichtbarer Zeitraum 06:00–24:00 Uhr."}</span>
        <button type="button" className="cal-night-toggle" aria-pressed={startHour === 0} onClick={() => setVisibleStart(0)}>Nacht zeigen</button>
        <button type="button" className="cal-night-toggle" aria-pressed={startHour === 6} onClick={() => setVisibleStart(6)}>Ab 06:00</button>
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

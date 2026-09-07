"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { calStore, calCovered, calFetchWindow, calInvalidate, CalSourceState } from "@/lib/calendarStore";
import { requestJson } from "@/lib/http";

interface Ev {
  id: string; title: string; start: string; end: string | null;
  allDay: boolean; location: string | null; calendar: string;
  color: string; textColor: string; htmlLink: string | null;
  description?: string | null; source?: "google" | "icloud"; taskId?: string | null;
}
type View = "month" | "week" | "year" | "agenda";

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
  const [view, setView] = useState<View>("month");
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
  }, [view, cursor, weekAnchor]);

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
            {(["week", "month", "year", "agenda"] as View[]).map((v) => (
              <button key={v} className={"cal-vbtn" + (view === v ? " on" : "")} onClick={() => setView(v)}>
                {v === "week" ? "Woche" : v === "month" ? "Monat" : v === "year" ? "Jahr" : "Agenda"}
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
      {sources.icloud?.state === "needs_reauth" && <div className="cal-note bad">Die iCloud-Zugangsdaten oder Berechtigung sind nicht mehr gültig. Bitte iCloud unten erneut verbinden.</div>}
      {taskSyncError && <div className="cal-note bad">{taskSyncError}</div>}

      {view === "month" && <MonthView cursor={cursor} byDay={byDay} todayKey={todayKey} selected={selected} setSelected={setSelected} loading={loading} />}
      {view === "week" && <WeekView anchor={weekAnchor} byDay={byDay} todayKey={todayKey} loading={loading} />}
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

function WeekView({ anchor, byDay, todayKey, loading }: any) {
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) { const d = new Date(anchor); d.setDate(anchor.getDate() + i); out.push(d); }
    return out;
  }, [anchor]);
  return (
    <div className="cal-week">
      {days.map((d) => {
        const k = ymd(d);
        const evs: Ev[] = byDay[k] || [];
        return (
          <div key={k} className={"cal-wcol" + (k === todayKey ? " today" : "")}>
            <div className="cal-wcol-h">
              <span className="cal-wcol-wd">{WD[(d.getDay() + 6) % 7]}</span>
              <span className="cal-wcol-d">{d.getDate()}</span>
            </div>
            <div className="cal-wcol-body">
              {loading ? <div className="cal-empty sm">…</div>
                : evs.length === 0 ? <div className="cal-wcol-empty" />
                : evs.map((e) => (
                  e.htmlLink
                    ? <a key={e.id} className="cal-wev" href={e.htmlLink} target="_blank" rel="noopener noreferrer" style={{ background: e.color, color: e.textColor }} title={e.title}>
                        {!e.allDay && <span className="cal-wev-t">{timeLabel(e)}</span>}{e.title}
                      </a>
                    : <div key={e.id} className="cal-wev" style={{ background: e.color, color: e.textColor }} title={e.title}>
                        {!e.allDay && <span className="cal-wev-t">{timeLabel(e)}</span>}{e.title}
                      </div>
                ))}
            </div>
          </div>
        );
      })}
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

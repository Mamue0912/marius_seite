"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Ev {
  id: string; title: string; start: string; end: string | null;
  allDay: boolean; location: string | null; calendar: string; htmlLink: string | null;
}

const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function evDayKey(e: Ev): string {
  // All-day-Termine haben start="YYYY-MM-DD"; getaktete Termine ISO mit Zeit.
  return e.allDay ? e.start.slice(0, 10) : ymd(new Date(e.start));
}
function timeLabel(e: Ev): string {
  if (e.allDay) return "ganztägig";
  const d = new Date(e.start);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export default function CalendarView({ initialEmail }: { initialEmail?: string | null }) {
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [view, setView] = useState<"month" | "agenda">("month");
  const [selected, setSelected] = useState<string>(() => ymd(new Date()));
  const [disconnecting, setDisconnecting] = useState(false);

  async function disconnect() {
    if (disconnecting || !confirm("Google-Kalender wirklich trennen?")) return;
    setDisconnecting(true);
    try {
      await fetch("/api/auth/google/disconnect", { method: "POST" });
      window.location.href = "/calendar";
    } catch { setDisconnecting(false); }
  }

  const range = useMemo(() => {
    // Sichtbares Monatsraster: von Montag der ersten Woche bis Sonntag der letzten.
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7; // Mo=0
    const gridStart = new Date(first); gridStart.setDate(first.getDate() - startOffset);
    const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
    return { gridStart, gridEnd };
  }, [cursor]);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNeedsReauth(false);
    try {
      const p = new URLSearchParams({ timeMin: range.gridStart.toISOString(), timeMax: range.gridEnd.toISOString() });
      const res = await fetch(`/api/calendar/events?${p.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.needsReauth) { setNeedsReauth(true); setEvents([]); }
      else if (data.error) { setError(data.error); setEvents([]); }
      else setEvents(data.events || []);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const byDay = useMemo(() => {
    const m: Record<string, Ev[]> = {};
    for (const e of events) { const k = evDayKey(e); (m[k] ||= []).push(e); }
    return m;
  }, [events]);

  const cells = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) { const d = new Date(range.gridStart); d.setDate(d.getDate() + i); out.push(d); }
    return out;
  }, [range]);

  const todayKey = ymd(new Date());
  const selectedEvents = byDay[selected] || [];

  // Agenda: alle geladenen Termine ab heute, chronologisch, nach Tag gruppiert.
  const agenda = useMemo(() => {
    const upcoming = [...events].filter((e) => evDayKey(e) >= todayKey).sort((a, b) => a.start.localeCompare(b.start));
    const groups: { day: string; items: Ev[] }[] = [];
    for (const e of upcoming) {
      const k = evDayKey(e);
      const g = groups.find((x) => x.day === k);
      if (g) g.items.push(e); else groups.push({ day: k, items: [e] });
    }
    return groups;
  }, [events, todayKey]);

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  return (
    <div className="cal">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="cal-btn" onClick={() => shiftMonth(-1)} aria-label="Vorheriger Monat">‹</button>
          <div className="cal-title">{MON[cursor.getMonth()]} {cursor.getFullYear()}</div>
          <button className="cal-btn" onClick={() => shiftMonth(1)} aria-label="Nächster Monat">›</button>
          <button className="cal-today" onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); setSelected(ymd(n)); }}>Heute</button>
        </div>
        <div className="cal-right">
          {initialEmail && <span className="cal-acct">{initialEmail}</span>}
          <div className="cal-viewswitch">
            <button className={"cal-vbtn" + (view === "month" ? " on" : "")} onClick={() => setView("month")}>Monat</button>
            <button className={"cal-vbtn" + (view === "agenda" ? " on" : "")} onClick={() => setView("agenda")}>Agenda</button>
          </div>
          <button className="cal-disc" onClick={disconnect} disabled={disconnecting}>{disconnecting ? "…" : "Trennen"}</button>
        </div>
      </div>

      {needsReauth && (
        <div className="cal-note bad">Die Google-Verbindung ist abgelaufen. <a href="/api/auth/google">Erneut verbinden</a></div>
      )}
      {error && <div className="cal-note bad">Kalender konnte nicht geladen werden: {error}</div>}

      {view === "month" ? (
        <div className="cal-grid-wrap">
          <div className="cal-wd">{WD.map((w) => <div key={w} className="cal-wdc">{w}</div>)}</div>
          <div className="cal-grid">
            {cells.map((d) => {
              const k = ymd(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const dayEvents = byDay[k] || [];
              return (
                <button
                  key={k}
                  className={"cal-cell" + (inMonth ? "" : " out") + (k === todayKey ? " today" : "") + (k === selected ? " sel" : "")}
                  onClick={() => setSelected(k)}
                >
                  <span className="cal-dnum">{d.getDate()}</span>
                  <span className="cal-dots">
                    {dayEvents.slice(0, 3).map((e) => <span key={e.id} className="cal-chip" title={e.title}>{e.allDay ? "" : timeLabel(e) + " "}{e.title}</span>)}
                    {dayEvents.length > 3 && <span className="cal-more">+{dayEvents.length - 3}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="cal-day">
            <div className="cal-day-h">{new Date(selected + "T00:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" })}</div>
            {loading ? <div className="cal-empty">lädt…</div>
              : selectedEvents.length === 0 ? <div className="cal-empty">Keine Termine an diesem Tag.</div>
              : selectedEvents.map((e) => <EventRow key={e.id} e={e} />)}
          </div>
        </div>
      ) : (
        <div className="cal-agenda">
          {loading ? <div className="cal-empty">lädt…</div>
            : agenda.length === 0 ? <div className="cal-empty">Keine anstehenden Termine in diesem Zeitraum.</div>
            : agenda.map((g) => (
              <div key={g.day} className="cal-agroup">
                <div className="cal-aday">{new Date(g.day + "T00:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short" })}</div>
                <div>{g.items.map((e) => <EventRow key={e.id} e={e} />)}</div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ e }: { e: Ev }) {
  const body = (
    <>
      <span className="cal-ev-time">{timeLabel(e)}</span>
      <span className="cal-ev-main">
        <span className="cal-ev-title">{e.title}</span>
        <span className="cal-ev-meta">{e.calendar}{e.location ? " · " + e.location : ""}</span>
      </span>
    </>
  );
  return e.htmlLink
    ? <a className="cal-ev" href={e.htmlLink} target="_blank" rel="noopener noreferrer">{body}</a>
    : <div className="cal-ev">{body}</div>;
}

"use client";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import Link from "next/link";
import { calStore, calFetchWindow, calDefaultWindow, CalEvent } from "@/lib/calendarStore";

// Kompakte Kalender-Kachel für die Übersicht: zeigt die nächsten Termine.
// Lädt über den gemeinsamen Kalender-Cache und wärmt damit genau das Fenster,
// das die Kalenderseite beim Öffnen braucht → Wechsel zum Kalender wirkt sofort.
function upcoming(): CalEvent[] {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const min = t0.getTime();
  return calStore().events
    .filter((e) => {
      const s = e.allDay ? new Date(e.start.slice(0, 10) + "T00:00:00").getTime() : new Date(e.start).getTime();
      return s >= min;
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 3);
}

export default function CalendarTile() {
  const [state, setState] = useState<"loading" | "connected" | "off" | "reauth">(() => calStore().events.length ? "connected" : "loading");
  const [events, setEvents] = useState<CalEvent[]>(() => upcoming());

  useEffect(() => {
    const { win } = calDefaultWindow();
    calFetchWindow(win.min, win.max).then((r) => {
      if (!r.connected) setState("off");
      else if (r.needsReauth) setState("reauth");
      else { setState("connected"); setEvents(upcoming()); }
    }).catch(() => setState("off"));
  }, []);

  return (
    <Link className="tile" href="/calendar" prefetch>
      <div className="tile-h"><span className="tile-ic"><Icon name="calendar" /></span><span className="tile-t">Kalender</span><span className="tile-go"><Icon name="arrow" size={16} /></span></div>
      {state === "loading" && <div className="tile-empty">lädt…</div>}
      {state === "off" && <div className="tile-empty">Google-Kalender verbinden, um Termine hier zu sehen.</div>}
      {state === "reauth" && <div className="tile-empty">Google-Verbindung abgelaufen – neu verbinden.</div>}
      {state === "connected" && (events.length === 0
        ? <div className="tile-empty">Keine anstehenden Termine.</div>
        : events.map((e) => (
            <div className="tile-row" key={e.id}>
              <span className="tile-dot" style={{ background: e.color || "var(--accent)" }} />
              <span className="tile-when">{e.allDay
                ? new Date(e.start + "T00:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
                : new Date(e.start).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</span> {e.title}
            </div>
          )))}
    </Link>
  );
}

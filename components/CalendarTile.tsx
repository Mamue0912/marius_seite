"use client";
import { useEffect, useState } from "react";

interface Ev { id: string; title: string; start: string; allDay: boolean; color?: string }

// Kompakte Kalender-Kachel für die Übersicht: zeigt die nächsten Termine,
// oder einen Hinweis zum Verbinden. Lädt clientseitig, damit das Dashboard
// serverseitig schnell bleibt.
export default function CalendarTile() {
  const [state, setState] = useState<"loading" | "connected" | "off" | "reauth">("loading");
  const [events, setEvents] = useState<Ev[]>([]);

  useEffect(() => {
    const now = new Date();
    const max = new Date(now.getTime() + 30 * 864e5);
    const p = new URLSearchParams({ timeMin: now.toISOString(), timeMax: max.toISOString() });
    fetch(`/api/calendar/events?${p.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.connected) setState("off");
        else if (d.needsReauth) setState("reauth");
        else { setState("connected"); setEvents((d.events || []).slice(0, 3)); }
      })
      .catch(() => setState("off"));
  }, []);

  return (
    <a className="tile" href="/calendar">
      <div className="tile-h"><span className="tile-ic">▦</span><span className="tile-t">Kalender</span><span className="tile-go">→</span></div>
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
    </a>
  );
}

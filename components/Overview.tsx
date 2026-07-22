"use client";
import { PROVIDERS } from "@/lib/mailProviders";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 17) return "Guten Tag";
  if (h < 22) return "Guten Abend";
  return "Gute Nacht";
}

export default function Overview({ accounts, summary, newest, needsReplyList, deadlineList, appStats }: any) {
  const dateStr = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const parts: string[] = [];
  if (summary.needsReply) parts.push(`${summary.needsReply} E-Mail${summary.needsReply === 1 ? "" : "s"} mit Antwortbedarf`);
  if (summary.deadlines) parts.push(`${summary.deadlines} erkannte Frist${summary.deadlines === 1 ? "" : "en"}`);
  if (summary.totalUnread) parts.push(`${summary.totalUnread} ungelesen`);
  const line = parts.length ? parts.join(" · ") : "Alles ruhig – nichts Dringendes.";

  return (
    <div className="ov">
      <header className="ov-hero">
        <h1>{greeting()}, Marius</h1>
        <div className="ov-date">{dateStr}</div>
        <div className="ov-sum">{line}</div>
      </header>

      <div className="ov-grid">
        <a className="tile" href="/mail">
          <div className="tile-h"><span className="tile-ic">✉</span><span className="tile-t">E-Mails</span><span className="tile-go">→</span></div>
          <div className="tile-stats">
            <div className="stat"><span className="stat-n">{summary.needsReply}</span><span className="stat-l">Antwort nötig</span></div>
            <div className="stat"><span className="stat-n">{summary.unreadImportant}</span><span className="stat-l">wichtig ungelesen</span></div>
            <div className="stat"><span className="stat-n">{summary.totalUnread}</span><span className="stat-l">ungelesen gesamt</span></div>
          </div>
          {newest && <div className="tile-newest"><b>Neueste:</b> {newest.from_name || newest.from_address} — {newest.subject || "(kein Betreff)"}</div>}
          <div className="tile-accts">
            {accounts.map((a: any) => (
              <span className="acct-pill" key={a.id}>{PROVIDERS[a.provider]?.label || a.provider} · {a.unread}</span>
            ))}
          </div>
        </a>

        <a className="tile tile-primary" href="/applications">
          <div className="tile-h"><span className="tile-ic">💼</span><span className="tile-t">Bewerbungen</span><span className="tile-go">→</span></div>
          <div className="tile-stats">
            <div className="stat"><span className="stat-n">{appStats?.active || 0}</span><span className="stat-l">aktiv</span></div>
            <div className="stat"><span className="stat-n">{appStats?.prep || 0}</span><span className="stat-l">in Vorbereitung</span></div>
            <div className="stat"><span className="stat-n">{appStats?.waiting || 0}</span><span className="stat-l">warte auf Antwort</span></div>
          </div>
          {appStats?.next && (
            <div className="tile-inrow" onClick={(e) => { e.preventDefault(); window.location.href = `/applications?open=${appStats.next.id}`; }}>
              <span className="il"><b>Nächste Handlung:</b> {appStats.next.text}</span><span className="iv">→</span>
            </div>
          )}
          {(appStats?.deadlines || []).map((d: any) => (
            <div className="tile-inrow" key={d.id} onClick={(e) => { e.preventDefault(); window.location.href = `/applications?open=${d.id}`; }}>
              <span className="il">Frist: {d.label}</span><span className="iv">{new Date(d.deadline).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</span>
            </div>
          ))}
          {appStats?.last && (
            <div className="tile-inrow" onClick={(e) => { e.preventDefault(); window.location.href = `/applications?open=${appStats.last.id}`; }}>
              <span className="il">Zuletzt: {appStats.last.label}</span><span className="iv">→</span>
            </div>
          )}
          {!appStats?.total && <div className="tile-empty">Noch keine Bewerbungen. Erste Stelle einfügen.</div>}
          <div className="tile-chiprow">
            <span className="tile-chip accent" onClick={(e) => { e.preventDefault(); window.location.href = "/applications?view=neu"; }}>＋ Neue Stelle</span>
            <span className="tile-chip" onClick={(e) => { e.preventDefault(); window.location.href = "/applications?view=aktiv"; }}>Aktive Bewerbungen</span>
            <span className="tile-chip" onClick={(e) => { e.preventDefault(); window.location.href = "/applications?view=unterlagen"; }}>Unterlagen</span>
          </div>
        </a>

        <a className="tile" href="/deadlines">
          <div className="tile-h"><span className="tile-ic">◎</span><span className="tile-t">Termine & Fristen</span><span className="tile-go">→</span></div>
          <div className="tile-stats">
            <div className="stat"><span className="stat-n">{summary.deadlines}</span><span className="stat-l">erkannte Fristen</span></div>
          </div>
          {deadlineList.length > 0 ? deadlineList.map((m: any) => (
            <div className="tile-row" key={m.id}><span className="tile-when">{new Date(m.deadline_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</span> {m.subject || m.from_name}</div>
          )) : <div className="tile-empty">Keine offenen Fristen erkannt.</div>}
        </a>

        <a className="tile" href="/calendar">
          <div className="tile-h"><span className="tile-ic">▦</span><span className="tile-t">Kalender</span><span className="tile-go">→</span></div>
          <div className="tile-empty">Google-Kalender noch nicht in dieser App verbunden. Zum Einrichten öffnen.</div>
        </a>

        <a className="tile" href="/tasks">
          <div className="tile-h"><span className="tile-ic">☑</span><span className="tile-t">Aufgaben</span><span className="tile-go">→</span></div>
          <div className="tile-empty">Aufgaben verwalten – auch ohne Fälligkeitsdatum.</div>
        </a>

        <div className="tile">
          <div className="tile-h"><span className="tile-ic">✎</span><span className="tile-t">Antwort nötig</span></div>
          {needsReplyList.length > 0 ? needsReplyList.map((m: any) => (
            <div className="tile-row" key={m.id}><b>{m.from_name || m.from_address}</b><br /><span className="tile-sub">{m.subject || "(kein Betreff)"}</span></div>
          )) : <div className="tile-empty">Keine offenen Antworten. 🎉</div>}
        </div>
      </div>
    </div>
  );
}

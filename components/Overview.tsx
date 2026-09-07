"use client";
import { PROVIDERS } from "@/lib/mailProviders";
import CalendarTile from "@/components/CalendarTile";
import Icon from "@/components/Icon";

type Task = { id: string; title: string; note?: string | null; due_at?: string | null; priority?: string; status?: string; source?: string };

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 17) return "Guten Tag";
  if (h < 22) return "Guten Abend";
  return "Gute Nacht";
}
function dayStart(value: Date | string = new Date()) { const d = typeof value === "string" ? new Date(value) : new Date(value.getTime()); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dueLabel(value?: string | null) {
  if (!value) return "Ohne Datum";
  const date = new Date(value), diff = Math.round((dayStart(date) - dayStart()) / 864e5);
  if (diff < 0) return "Überfällig";
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
}

export default function Overview({ accounts, summary, newestUnread = [], needsReplyList, appStats, tasks = [], loadErrors = {} }: any) {
  const dateStr = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const openTasks: Task[] = [...tasks].filter((task) => task.status !== "erledigt").sort((a, b) => {
    const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    const priorityRank = (priority?: string) => priority === "dringend" ? 3 : priority === "hoch" ? 2 : priority === "normal" ? 1 : 0;
    return priorityRank(b.priority) - priorityRank(a.priority) || aDue - bDue;
  });
  const focusTask = openTasks[0];
  const focusMail = needsReplyList[0];
  const focus = focusTask
    ? { eyebrow: focusTask.due_at && dayStart(focusTask.due_at) < dayStart() ? "Überfällige Aufgabe" : "Nächster Schritt", title: focusTask.title, detail: focusTask.note || `${dueLabel(focusTask.due_at)}${focusTask.priority === "dringend" ? " · dringend" : focusTask.priority === "hoch" ? " · hohe Priorität" : ""}`, href: `/tasks?open=${focusTask.id}`, icon: "tasks" }
    : appStats?.next
      ? { eyebrow: "Nächster Bewerbungsschritt", title: appStats.next.text, detail: "Bewerbungsprojekt öffnen und weiterarbeiten", href: `/applications?open=${appStats.next.id}`, icon: "briefcase" }
      : focusMail
        ? { eyebrow: "Antwort ausstehend", title: focusMail.subject || "E-Mail beantworten", detail: focusMail.from_name || focusMail.from_address || "Posteingang", href: `/mail?open=${focusMail.id}`, icon: "mail" }
        : { eyebrow: "Für heute", title: "Alles Wichtige ist erledigt", detail: "Neue Aufgaben und Nachrichten erscheinen automatisch hier.", href: "/tasks", icon: "check" };

  const parts: string[] = [];
  if (summary.needsReply) parts.push(`${summary.needsReply} Antwort${summary.needsReply === 1 ? "" : "en"}`);
  if (summary.dueToday) parts.push(`${summary.dueToday} heute fällig`);
  if (summary.overdueTasks) parts.push(`${summary.overdueTasks} überfällig`);
  const dayLine = parts.length ? parts.join(" · ") : "Keine dringenden Punkte offen.";

  return (
    <main className="ov">
      <header className="ov-hero ov-command">
        <div className="ov-hero-copy">
          <div className="ov-eyebrow">{dateStr}</div>
          <h1>{greeting()}, Marius</h1>
          <p className="ov-sum">{dayLine}</p>
        </div>
        <nav className="ov-quick-actions" aria-label="Schnellaktionen">
          <a href="/tasks"><Icon name="plus" size={16} /> Aufgabe &amp; Frist</a>
          <a href="/mail"><Icon name="edit" size={16} /> E-Mail</a>
          <a className="primary" href="/applications?view=neu"><Icon name="briefcase" size={16} /> Neue Stelle</a>
        </nav>
      </header>

      <section className="ov-metrics" aria-label="Tagesstatus">
        <a href="/tasks" className={summary.overdueTasks ? "attention" : ""}><span className="ov-metric-label">Aufgaben &amp; Fristen</span><strong>{openTasks.length}</strong><small>{summary.overdueTasks ? `${summary.overdueTasks} überfällig` : "im Plan"}</small></a>
        <a href="/mail?unread=1"><span className="ov-metric-label">Ungelesen</span><strong>{summary.totalUnread}</strong><small>{summary.unreadImportant} wichtig</small></a>
        <a href="/mail"><span className="ov-metric-label">Antworten</span><strong>{summary.needsReply}</strong><small>noch ausstehend</small></a>
        <a href="/applications"><span className="ov-metric-label">Bewerbungen</span><strong>{appStats?.active || 0}</strong><small>{appStats?.waiting || 0} warten</small></a>
      </section>

      <div className="ov-priority-grid">
        <section className="ov-focus-panel">
          <div className="ov-section-head"><span>Mein Fokus</span><span className="ov-live"><i /> automatisch priorisiert</span></div>
          {loadErrors.tasks && <div className="ov-panel-error" role="alert">{loadErrors.tasks} Die übrigen Bereiche bleiben verfügbar.</div>}
          <a className="ov-focus-card" href={focus.href}>
            <span className="ov-focus-icon"><Icon name={focus.icon} size={22} /></span>
            <span className="ov-focus-copy"><small>{focus.eyebrow}</small><strong>{focus.title}</strong><span>{focus.detail}</span></span>
            <span className="ov-focus-go"><Icon name="arrow" size={18} /></span>
          </a>
          <div className="ov-agenda-list">
            {openTasks.slice(focusTask ? 1 : 0, focusTask ? 4 : 3).map((task) => (
              <a href={`/tasks?open=${task.id}`} className="ov-agenda-row" key={task.id}>
                <span className={"ov-agenda-dot " + (task.priority === "hoch" ? "high" : "task")} />
                <span className="ov-agenda-main"><strong>{task.title}</strong><small>{task.source === "icloud_calendar" ? "iCloud-Kalender" : task.source === "mail" ? "E-Mail-Frist" : task.source === "bewerbung" ? "Bewerbungsfrist" : "Aufgabe"} · {dueLabel(task.due_at)}</small></span>
                <Icon name="chevron" size={15} />
              </a>
            ))}
            {!openTasks.length && <div className="ov-quiet"><Icon name="check" size={18} /> Keine weiteren dringenden Punkte.</div>}
          </div>
          <a className="ov-panel-link" href="/tasks">Alle Aufgaben &amp; Fristen <Icon name="arrow" size={14} /></a>
        </section>

        <section className="ov-inbox-panel">
          <div className="ov-section-head"><span>Neu im Posteingang</span><a href="/mail">Alle anzeigen</a></div>
          {loadErrors.mail && <div className="ov-panel-error" role="alert">{loadErrors.mail} Bitte das Postfach erneut synchronisieren.</div>}
          <div className="ov-mail-list">
            {newestUnread.length ? newestUnread.slice(0, 4).map((mail: any) => (
              <a className="ov-mail-row" href={`/mail?open=${mail.id}`} key={mail.id}>
                <span className="ov-avatar">{String(mail.from || "?").trim().slice(0, 1).toUpperCase()}</span>
                <span className="ov-mail-copy"><strong>{mail.from || "Unbekannter Absender"}</strong><span>{mail.subject}</span><small>{PROVIDERS[mail.provider]?.label || mail.provider}</small></span>
                <time>{mail.at ? new Date(mail.at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : ""}</time>
              </a>
            )) : <div className="ov-empty"><Icon name="mail" size={22} /><strong>Posteingang aufgeräumt</strong><span>Keine ungelesenen Nachrichten.</span></div>}
          </div>
          <div className="ov-account-strip">{accounts.map((account: any) => <span key={account.id}>{PROVIDERS[account.provider]?.label || account.provider}<b>{account.unread}</b></span>)}</div>
        </section>
      </div>

      <div className="ov-secondary-grid">
        <section className="ov-app-panel">
          <div className="ov-section-head"><span>Bewerbungen</span><a href="/applications">Manager öffnen</a></div>
          {loadErrors.applications && <div className="ov-panel-error" role="alert">{loadErrors.applications} Bitte den Bewerbungsmanager erneut öffnen.</div>}
          <div className="ov-app-summary">
            <div><strong>{appStats?.active || 0}</strong><span>aktiv</span></div>
            <div><strong>{appStats?.prep || 0}</strong><span>in Vorbereitung</span></div>
            <div><strong>{appStats?.waiting || 0}</strong><span>warten auf Antwort</span></div>
          </div>
          {appStats?.next ? <a className="ov-next-app" href={`/applications?open=${appStats.next.id}`}><span><small>Nächste Handlung</small><strong>{appStats.next.text}</strong></span><Icon name="arrow" size={17} /></a> : <div className="ov-quiet">Keine offene Bewerbungshandlung.</div>}
        </section>
        <CalendarTile />
      </div>
    </main>
  );
}

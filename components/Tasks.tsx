"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { Notice, notify } from "./Feedback";
import { requestJson, jsonRequest } from "@/lib/http";
import { taskBucket, TASK_BUCKETS } from "@/lib/taskDates";
import { taskPriorityRank } from "@/lib/taskValidation";

type Task = {
  id: string; title: string; note: string | null; priority: string; due_at: string | null;
  status: string; source: string; category?: string | null; starts_at?: string | null;
  ends_at?: string | null; all_day?: boolean; location?: string | null; calendar_name?: string | null;
  external_id?: string | null; external_url?: string | null; linked_message_id?: string | null;
  linked_application_id?: string | null; reminder_at?: string | null;
};

const PRIORITY_LABEL: Record<string, string> = { dringend: "Dringend", hoch: "Hoch", normal: "Normal", niedrig: "Niedrig" };
const SOURCE_LABEL: Record<string, string> = {
  manuell: "Manuell", mail: "E-Mail", bewerbung: "Bewerbung",
  icloud_calendar: "iCloud-Kalender", apple: "Apple", apple_erinnerungen: "Apple Erinnerungen"
};
const CATEGORIES = ["Schule", "Bewerbung", "Sport", "Privat", "Finanzen", "Reisen", "Projekte", "Kalender", "Sonstiges"];

function dueText(task: Task): string {
  if (!task.due_at) return "Ohne Datum";
  const date = new Date(task.due_at);
  const day = date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  return task.all_day ? day : `${day}, ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

function linkedHref(task: Task): string | null {
  if (task.linked_message_id) return `/mail?open=${encodeURIComponent(task.linked_message_id)}`;
  if (task.linked_application_id) return `/applications?open=${encodeURIComponent(task.linked_application_id)}`;
  if (task.source === "icloud_calendar") return "/calendar";
  return task.external_url || null;
}

export default function Tasks({ initial, initialError = null, initialOpenId = null, initialSource = "all" }: { initial: Task[]; initialError?: string | null; initialOpenId?: string | null; initialSource?: string }) {
  const [tasks, setTasks] = useState(initial);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [time, setTime] = useState("12:00");
  const [allowNoDate, setAllowNoDate] = useState(false);
  const [category, setCategory] = useState("Sonstiges");
  const [prio, setPrio] = useState("normal");
  const [error, setError] = useState<string | null>(initialError);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState(initialSource || "all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [undo, setUndo] = useState<{ id: string; status: string } | null>(null);
  const locks = useRef(new Set<string>());

  useEffect(() => {
    if (!initialOpenId) return;
    requestAnimationFrame(() => document.getElementById(`task-${initialOpenId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [initialOpenId]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || (!due && !allowNoDate) || locks.current.has("add")) return;
    locks.current.add("add"); setAdding(true); setError(null);
    try {
      const dueAt = due ? new Date(`${due}T${time || "12:00"}:00`).toISOString() : null;
      const data = await requestJson("/api/tasks", jsonRequest("POST", { title: title.trim(), note: note.trim() || null, due_at: dueAt, priority: prio, category, allow_no_date: allowNoDate }));
      if (!data.task) throw new Error("Eintrag konnte nicht gespeichert werden.");
      setTasks((current) => [data.task, ...current]);
      setTitle(""); setNote(""); setDue(""); setTime("12:00"); setAllowNoDate(false); setCategory("Sonstiges"); setPrio("normal");
      notify("Aufgabe oder Frist hinzugefügt.");
    } catch (caught) { setError((caught as Error).message); }
    finally { locks.current.delete("add"); setAdding(false); }
  }

  async function patch(task: Task, update: Partial<Task>) {
    if (locks.current.has(task.id)) return;
    locks.current.add(task.id); setPending(new Set(locks.current)); setError(null);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...update } : item));
    try {
      const data = await requestJson("/api/tasks", jsonRequest("PATCH", { id: task.id, ...update }));
      if (!data.task) throw new Error("Änderung konnte nicht gespeichert werden.");
      setTasks((current) => current.map((item) => item.id === task.id ? data.task : item));
      if (update.status) setUndo({ id: task.id, status: task.status });
    } catch (caught) { setTasks((current) => current.map((item) => item.id === task.id ? task : item)); setError((caught as Error).message); }
    finally { locks.current.delete(task.id); setPending(new Set(locks.current)); }
  }

  async function remove(task: Task) {
    if (task.external_id) { setError("Automatisch synchronisierte Einträge werden an ihrer Quelle verwaltet."); return; }
    if (locks.current.has(task.id) || !confirm(`„${task.title}“ löschen?`)) return;
    locks.current.add(task.id); setPending(new Set(locks.current)); setError(null);
    try { await requestJson("/api/tasks", jsonRequest("DELETE", { id: task.id })); setTasks((current) => current.filter((item) => item.id !== task.id)); notify("Eintrag gelöscht."); }
    catch (caught) { setError((caught as Error).message); }
    finally { locks.current.delete(task.id); setPending(new Set(locks.current)); }
  }

  const normalizedQuery = query.toLocaleLowerCase("de");
  const categories = Array.from(new Set(tasks.map((task) => task.category).filter(Boolean) as string[])).sort();
  const visible = tasks.filter((task) => {
    // "ignoriert" erscheint nur, wenn ausdrücklich danach gefiltert wird –
    // die Einträge bleiben erhalten und lassen sich zurückholen.
    const statusMatches = statusFilter === "ignoriert"
      ? task.status === "ignoriert"
      : task.status !== "ignoriert" && (statusFilter === "all" || (statusFilter === "open" ? task.status !== "erledigt" : task.status === statusFilter));
    return statusMatches && (sourceFilter === "all" || task.source === sourceFilter)
      && (categoryFilter === "all" || task.category === categoryFilter)
      && (task.title + " " + (task.note || "") + " " + (task.calendar_name || "")).toLocaleLowerCase("de").includes(normalizedQuery);
  });

  return <div className="page">
    <div className="page-head"><div><h1>Aufgaben &amp; Fristen</h1><p>Aufgaben, E-Mail-Fristen, Bewerbungen und Kalendertermine an einem Ort.</p></div></div>
    <div className="wrap-inner">
      <form className="task-add task-add-unified" onSubmit={add}>
        <div className="task-copy-fields">
          <label className="field">Titel<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Was steht an?" required maxLength={500} /></label>
          <label className="field">Beschreibung · optional<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Details oder nächster Schritt" maxLength={5000} /></label>
        </div>
        <label className="field">Datum<input type="date" value={due} disabled={allowNoDate} onChange={(event) => setDue(event.target.value)} required={!allowNoDate} /></label>
        <label className="field">Uhrzeit<input type="time" value={time} disabled={allowNoDate} onChange={(event) => setTime(event.target.value)} /></label>
        <label className="field">Kategorie<select value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field">Priorität<select value={prio} onChange={(event) => setPrio(event.target.value)}><option value="niedrig">Niedrig</option><option value="normal">Normal</option><option value="hoch">Hoch</option><option value="dringend">Dringend</option></select></label>
        <label className="chip task-no-date"><input type="checkbox" checked={allowNoDate} onChange={(event) => { setAllowNoDate(event.target.checked); if (event.target.checked) setDue(""); }} /> Bewusst ohne Datum</label>
        <button className="btn btn-primary" disabled={adding || !title.trim() || (!due && !allowNoDate)}>{adding ? "Speichert…" : "Hinzufügen"}</button>
      </form>

      {error && <Notice>{error}</Notice>}
      {undo && <div className="feedback" role="status"><span>Status gespeichert.</span><button type="button" className="btn small" onClick={() => { const task=tasks.find((item)=>item.id===undo.id); if(task) void patch(task,{status:undo.status}); setUndo(null); }}>Rückgängig</button><button type="button" className="icon-button" aria-label="Meldung schließen" onClick={() => setUndo(null)}><Icon name="close" /></button></div>}

      <div className="task-filter task-filter-unified">
        <input type="search" aria-label="Aufgaben und Fristen durchsuchen" placeholder="Aufgaben & Fristen durchsuchen" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Status filtern" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="open">Offen</option><option value="all">Alle Status</option><option value="warten">Warten</option><option value="erledigt">Erledigt</option><option value="ignoriert">Nicht als Aufgabe</option></select>
        <select aria-label="Quelle filtern" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">Alle Quellen</option>{Object.entries(SOURCE_LABEL).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Kategorie filtern" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Alle Kategorien</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>
      </div>

      {TASK_BUCKETS.map((bucket) => {
        const list = visible.filter((task) => taskBucket(task) === bucket).sort((a,b) => taskPriorityRank(b.priority)-taskPriorityRank(a.priority) || String(a.due_at || "z").localeCompare(String(b.due_at || "z")));
        return list.length ? <section className="bucket" key={bucket}><div className="bh"><h2 className="bt">{bucket}</h2><span className="bc">{list.length}</span></div>
          {list.map((task) => { const href=linkedHref(task); return <article id={`task-${task.id}`} className={`task${task.status === "erledigt" ? " done" : ""}${task.external_id ? " imported" : ""}${initialOpenId === task.id ? " selected" : ""}`} key={task.id} aria-busy={pending.has(task.id)}>
            <button type="button" className="task-check" disabled={pending.has(task.id)} aria-label={task.status === "erledigt" ? "Wieder öffnen" : "Erledigen"} onClick={() => void patch(task,{status:task.status === "erledigt" ? "offen" : "erledigt"})}>{task.status === "erledigt" && <Icon name="check" size={14} />}</button>
            <div className="task-body"><div className="task-title">{task.title}</div>{task.note && <div className="task-note">{task.note}</div>}
              <div className="task-meta"><span>{dueText(task)}</span><span>{PRIORITY_LABEL[task.priority] || "Normal"}</span><span>{task.category || "Sonstiges"}</span><span>{SOURCE_LABEL[task.source] || task.source}</span>{task.calendar_name && <span>{task.calendar_name}</span>}{task.location && <span>{task.location}</span>}</div>
            </div>
            <div className="task-actions">{href && <a className="icon-button" href={href} title="Quelle öffnen" aria-label="Quelle öffnen"><Icon name="arrow" /></a>}{task.status !== "erledigt" && <button type="button" className="icon-button" disabled={pending.has(task.id)} title={task.status === "warten" ? "Wieder aufnehmen" : "Auf Rückmeldung warten"} onClick={() => void patch(task,{status:task.status === "warten" ? "offen" : "warten"})}><Icon name={task.status === "warten" ? "refresh" : "clock"} /></button>}{task.external_id && task.status !== "ignoriert" && <button type="button" className="icon-button" title="Keine Aufgabe – dauerhaft aus der Liste nehmen" aria-label="Nicht als Aufgabe führen" disabled={pending.has(task.id)} onClick={() => void patch(task,{status:"ignoriert"})}><Icon name="close" /></button>}
            {task.status === "ignoriert" && <button type="button" className="icon-button" title="Doch als Aufgabe führen" aria-label="Doch als Aufgabe führen" disabled={pending.has(task.id)} onClick={() => void patch(task,{status:"offen"})}><Icon name="refresh" /></button>}
            {!task.external_id && <button type="button" className="icon-button" aria-label="Eintrag löschen" disabled={pending.has(task.id)} onClick={() => void remove(task)}><Icon name="trash" /></button>}</div>
          </article>; })}
        </section> : null;
      })}
      {!visible.length && <div className="empty"><Icon name="tasks" size={30} /><p>Keine passenden Aufgaben oder Fristen.</p><div className="sub">Bestehende Aufgaben ohne Datum erscheinen im Bereich „Ohne Datum“.</div></div>}
    </div>
  </div>;
}
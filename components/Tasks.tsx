"use client";
import { useRef, useState } from "react";
import Icon from "./Icon";
import { Notice, notify } from "./Feedback";
import { requestJson, jsonRequest } from "@/lib/http";
import { taskBucket, TASK_BUCKETS } from "@/lib/taskDates";
import { taskPriorityRank } from "@/lib/taskValidation";

type Task = { id: string; title: string; note: string | null; priority: string; due_at: string | null; status: string; source: string };

const PRIORITY_LABEL: Record<string, string> = {
  dringend: "Dringend",
  hoch: "Hoch",
  normal: "Normal",
  niedrig: "Niedrig"
};

export default function Tasks({ initial, initialError = null }: { initial: Task[]; initialError?: string | null }) {
  const [tasks, setTasks] = useState(initial);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [prio, setPrio] = useState("normal");
  const [error, setError] = useState<string | null>(initialError);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [undo, setUndo] = useState<{ id: string; status: string } | null>(null);
  const locks = useRef(new Set<string>());

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || locks.current.has("add")) return;
    locks.current.add("add");
    setAdding(true);
    setError(null);
    try {
      const data = await requestJson("/api/tasks", jsonRequest("POST", {
        title: title.trim(),
        note: note.trim() || null,
        due_at: due ? new Date(due + "T12:00:00").toISOString() : null,
        priority: prio
      }));
      if (!data.task) throw new Error("Aufgabe konnte nicht gespeichert werden.");
      setTasks((current) => [data.task, ...current]);
      setTitle("");
      setNote("");
      setDue("");
      setPrio("normal");
      notify("Aufgabe hinzugefügt.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      locks.current.delete("add");
      setAdding(false);
    }
  }

  async function patch(task: Task, update: Partial<Task>) {
    if (locks.current.has(task.id)) return;
    locks.current.add(task.id);
    setPending(new Set(locks.current));
    setError(null);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...update } : item));
    try {
      const data = await requestJson("/api/tasks", jsonRequest("PATCH", { id: task.id, ...update }));
      if (!data.task) throw new Error("Änderung konnte nicht gespeichert werden.");
      setTasks((current) => current.map((item) => item.id === task.id ? data.task : item));
      if (update.status) setUndo({ id: task.id, status: task.status });
    } catch (caught) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      setError((caught as Error).message);
    } finally {
      locks.current.delete(task.id);
      setPending(new Set(locks.current));
    }
  }

  async function remove(task: Task) {
    if (locks.current.has(task.id) || !confirm("Aufgabe „" + task.title + "“ löschen?")) return;
    locks.current.add(task.id);
    setPending(new Set(locks.current));
    setError(null);
    try {
      await requestJson("/api/tasks", jsonRequest("DELETE", { id: task.id }));
      setTasks((current) => current.filter((item) => item.id !== task.id));
      notify("Aufgabe gelöscht.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      locks.current.delete(task.id);
      setPending(new Set(locks.current));
    }
  }

  const normalizedQuery = query.toLocaleLowerCase("de");
  const visible = tasks.filter((task) =>
    (showDone || task.status !== "erledigt")
    && (task.title + " " + (task.note || "")).toLocaleLowerCase("de").includes(normalizedQuery)
  );

  return <div className="page">
    <div className="page-head"><h1>Aufgaben</h1></div>
    <div className="wrap-inner">
      <form className="task-add" onSubmit={add}>
        <div className="task-copy-fields">
          <label className="field">Aufgabe<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Was steht an?" required maxLength={500} /></label>
          <label className="field">Notiz · optional<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Details oder nächster Schritt" maxLength={5000} /></label>
        </div>
        <label className="field">Fällig am · optional<input type="date" value={due} onChange={(event) => setDue(event.target.value)} /></label>
        <label className="field">Priorität<select value={prio} onChange={(event) => setPrio(event.target.value)}>
          <option value="niedrig">Niedrig</option>
          <option value="normal">Normal</option>
          <option value="hoch">Hoch</option>
          <option value="dringend">Dringend</option>
        </select></label>
        <button className="btn btn-primary" disabled={adding || !title.trim()}>{adding ? "Speichert…" : "Hinzufügen"}</button>
      </form>

      {error && <Notice>{error}</Notice>}
      {undo && <div className="feedback" role="status">
        <span>Status gespeichert.</span>
        <button className="btn small" onClick={() => {
          const task = tasks.find((item) => item.id === undo.id);
          if (task) void patch(task, { status: undo.status });
          setUndo(null);
        }}>Rückgängig</button>
        <button className="icon-button" aria-label="Meldung schließen" onClick={() => setUndo(null)}><Icon name="close" /></button>
      </div>}

      <div className="task-filter">
        <input type="search" aria-label="Aufgaben durchsuchen" placeholder="Aufgaben durchsuchen" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label className="chip"><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} /> Erledigte anzeigen</label>
      </div>

      {TASK_BUCKETS.map((bucket) => {
        const list = visible
          .filter((task) => taskBucket(task) === bucket)
          .sort((a, b) => taskPriorityRank(b.priority) - taskPriorityRank(a.priority));
        return list.length ? <section className="bucket" key={bucket}>
          <div className="bh"><h2 className="bt">{bucket}</h2><span className="bc">{list.length}</span></div>
          {list.map((task) => <article className={"task" + (task.status === "erledigt" ? " done" : "")} key={task.id} aria-busy={pending.has(task.id)}>
            <button className="task-check" disabled={pending.has(task.id)} aria-label={task.status === "erledigt" ? "Aufgabe wieder öffnen" : "Aufgabe erledigen"} onClick={() => patch(task, { status: task.status === "erledigt" ? "offen" : "erledigt" })}>{task.status === "erledigt" && <Icon name="check" size={14} />}</button>
            <div className="task-body">
              <div className="task-title">{task.title}</div>
              {task.note && <div className="task-note">{task.note}</div>}
              <div className="task-meta">
                {task.due_at ? new Date(task.due_at).toLocaleDateString("de-DE") : "Ohne Frist"}
                {" · " + (PRIORITY_LABEL[task.priority] || "Normal") + " · "}
                {task.source === "manuell" ? "Manuell" : task.source}
              </div>
            </div>
            <div className="task-actions">
              {task.status !== "erledigt" && <button className="icon-button" disabled={pending.has(task.id)} title={task.status === "warten" ? "Wieder aufnehmen" : "Auf Rückmeldung warten"} aria-label={task.status === "warten" ? "Wieder aufnehmen" : "Auf Rückmeldung warten"} onClick={() => patch(task, { status: task.status === "warten" ? "offen" : "warten" })}><Icon name={task.status === "warten" ? "refresh" : "clock"} /></button>}
              <button className="icon-button" aria-label="Aufgabe löschen" disabled={pending.has(task.id)} onClick={() => remove(task)}><Icon name="trash" /></button>
            </div>
          </article>)}
        </section> : null;
      })}

      {!visible.length && <div className="empty"><Icon name="tasks" size={30} /><p>{query ? "Keine passenden Aufgaben." : "Hier ist alles erledigt."}</p><div className="sub">Neue Aufgaben können auch ohne Datum angelegt werden.</div></div>}
    </div>
  </div>;
}
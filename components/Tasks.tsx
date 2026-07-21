"use client";
import { useState } from "react";

type Task = { id: string; title: string; note: string | null; priority: string; due_at: string | null; status: string; source: string };

function bucketOf(t: Task): string {
  if (t.status === "erledigt") return "Erledigt";
  if (t.status === "warten") return "Warten auf Rückmeldung";
  if (!t.due_at) return "Ohne Frist";
  const d = new Date(t.due_at); const now = new Date();
  const days = Math.floor((d.getTime() - new Date(now.toDateString()).getTime()) / 864e5);
  if (days < 0) return "Überfällig";
  if (days === 0) return "Heute";
  if (days <= 7) return "Diese Woche";
  return "Später";
}
const ORDER = ["Überfällig", "Heute", "Diese Woche", "Später", "Ohne Frist", "Warten auf Rückmeldung", "Erledigt"];

export default function Tasks({ initial }: { initial: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [prio, setPrio] = useState("normal");

  async function add() {
    if (!title.trim()) return;
    const r = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, due_at: due || null, priority: prio }) });
    const j = await r.json();
    if (j.task) { setTasks((t) => [j.task, ...t]); setTitle(""); setDue(""); }
  }
  async function patch(id: string, p: any) {
    setTasks((t) => t.map((x) => x.id === id ? { ...x, ...p } : x));
    await fetch("/api/tasks", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...p }) });
  }
  async function del(id: string) {
    setTasks((t) => t.filter((x) => x.id !== id));
    await fetch("/api/tasks", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
  }

  return (
    <div className="page">
      <div className="page-head"><h1>Aufgaben</h1></div>
      <div className="wrap-inner">
        <div className="task-add">
          <input placeholder="Neue Aufgabe…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title="Fälligkeit (optional)" />
          <select value={prio} onChange={(e) => setPrio(e.target.value)}><option value="niedrig">Niedrig</option><option value="normal">Normal</option><option value="hoch">Hoch</option></select>
          <button className="btn btn-primary" onClick={add} disabled={!title.trim()}>Hinzufügen</button>
        </div>

        {ORDER.map((b) => {
          const list = tasks.filter((t) => bucketOf(t) === b);
          if (!list.length) return null;
          return (
            <div className="bucket" key={b}>
              <div className="bh"><span className="bt">{b}</span><span className="bc">{list.length}</span></div>
              {list.map((t) => (
                <div className={"task" + (t.status === "erledigt" ? " done" : "")} key={t.id}>
                  <button className="task-check" onClick={() => patch(t.id, { status: t.status === "erledigt" ? "offen" : "erledigt" })} aria-label="Erledigt">{t.status === "erledigt" ? "✓" : ""}</button>
                  <div className="task-body">
                    <div className="task-title">{t.title}</div>
                    <div className="task-meta">
                      {t.due_at ? new Date(t.due_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : "Ohne Frist"}
                      {t.priority === "hoch" && <span className="cat-chip" style={{ marginLeft: 8 }}>Hoch</span>}
                      <span style={{ opacity: 0.5, marginLeft: 8 }}>{t.source}</span>
                    </div>
                  </div>
                  {t.status !== "erledigt" && <button className="btn small ghost" onClick={() => patch(t.id, { status: "warten" })} title="Warten">⏳</button>}
                  <button className="btn small ghost btn-danger" onClick={() => del(t.id)} title="Löschen">✕</button>
                </div>
              ))}
            </div>
          );
        })}
        {tasks.length === 0 && <div className="empty"><div className="ic">☑</div>Noch keine Aufgaben.<div className="sub">Aufgaben ohne Datum sind völlig in Ordnung.</div></div>}
      </div>
    </div>
  );
}

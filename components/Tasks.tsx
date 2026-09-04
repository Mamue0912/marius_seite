"use client";
import { useRef, useState } from "react";
import Icon from "./Icon";
import { Notice, notify } from "./Feedback";
import { requestJson, jsonRequest } from "@/lib/http";
import { taskBucket, TASK_BUCKETS } from "@/lib/taskDates";
type Task = {id:string;title:string;note:string|null;priority:string;due_at:string|null;status:string;source:string};
export default function Tasks({initial}: {initial:Task[]}) {
 const [tasks,setTasks]=useState(initial), [title,setTitle]=useState(""), [due,setDue]=useState(""), [prio,setPrio]=useState("normal");
 const [error,setError]=useState<string|null>(null), [adding,setAdding]=useState(false), [pending,setPending]=useState<Set<string>>(new Set());
 const [query,setQuery]=useState(""), [showDone,setShowDone]=useState(false);
 const [undo,setUndo]=useState<{id:string;status:string}|null>(null);
 const locks=useRef(new Set<string>());
 async function add(e:React.FormEvent) {
  e.preventDefault(); if(!title.trim() || locks.current.has("add")) return;
  locks.current.add("add");setAdding(true);setError(null);
  try { const data=await requestJson("/api/tasks",jsonRequest("POST",{title:title.trim(),due_at:due?new Date(due+"T00:00:00").toISOString():null,priority:prio})); if(!data.task) throw new Error("Aufgabe konnte nicht gespeichert werden."); setTasks(t=>[data.task,...t]);setTitle("");setDue("");notify("Aufgabe hinzugefügt."); }
  catch(e){setError((e as Error).message);} finally{locks.current.delete("add");setAdding(false);}
 }
 async function patch(task:Task, update:Partial<Task>) {
  if(locks.current.has(task.id)) return;
  locks.current.add(task.id);setPending(new Set(locks.current));setError(null);
  setTasks(ts=>ts.map(t=>t.id===task.id?{...t,...update}:t));
  try { const data=await requestJson("/api/tasks",jsonRequest("PATCH",{id:task.id,...update})); if(!data.task) throw new Error("Änderung konnte nicht gespeichert werden."); setTasks(ts=>ts.map(t=>t.id===task.id?data.task:t)); if(update.status) setUndo({id:task.id,status:task.status}); }
  catch(e){setTasks(ts=>ts.map(t=>t.id===task.id?task:t));setError((e as Error).message);}
  finally{locks.current.delete(task.id);setPending(new Set(locks.current));}
 }
 async function remove(task:Task) {
  if(locks.current.has(task.id)||!confirm("Aufgabe „"+task.title+"“ löschen?")) return;
  locks.current.add(task.id);setPending(new Set(locks.current));setError(null);
  try{await requestJson("/api/tasks",jsonRequest("DELETE",{id:task.id}));setTasks(ts=>ts.filter(t=>t.id!==task.id));notify("Aufgabe gelöscht.");}
  catch(e){setError((e as Error).message);} finally{locks.current.delete(task.id);setPending(new Set(locks.current));}
 }
 const visible=tasks.filter(t=>(showDone||t.status!=="erledigt")&&(t.title+" "+(t.note||"")).toLocaleLowerCase("de").includes(query.toLocaleLowerCase("de")));
 return <div className="page"><div className="page-head"><h1>Aufgaben</h1></div><div className="wrap-inner">
 <form className="task-add" onSubmit={add}>
 <label className="field">Aufgabe<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Was steht an?" required maxLength={500}/></label>
 <label className="field">Fällig am · optional<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
 <label className="field">Priorität<select value={prio} onChange={e=>setPrio(e.target.value)}><option value="niedrig">Niedrig</option><option value="normal">Normal</option><option value="hoch">Hoch</option></select></label>
 <button className="btn btn-primary" disabled={adding||!title.trim()}>{adding?"Speichert…":"Hinzufügen"}</button></form>
 {error&&<Notice>{error}</Notice>}
 {undo&&<div className="feedback" role="status"><span>Status gespeichert.</span><button className="btn small" onClick={()=>{const t=tasks.find(x=>x.id===undo.id);if(t)void patch(t,{status:undo.status});setUndo(null);}}>Rückgängig</button><button className="icon-button" aria-label="Meldung schließen" onClick={()=>setUndo(null)}><Icon name="close"/></button></div>}
 <div className="task-filter"><input type="search" aria-label="Aufgaben durchsuchen" placeholder="Aufgaben durchsuchen" value={query} onChange={e=>setQuery(e.target.value)}/><label className="chip"><input type="checkbox" checked={showDone} onChange={e=>setShowDone(e.target.checked)}/> Erledigte anzeigen</label></div>
 {TASK_BUCKETS.map(bucket=>{const list=visible.filter(t=>taskBucket(t)===bucket).sort((a,b)=>Number(b.priority==="hoch")-Number(a.priority==="hoch"));return list.length?<section className="bucket" key={bucket}><div className="bh"><h2 className="bt">{bucket}</h2><span className="bc">{list.length}</span></div>{list.map(t=><article className={"task"+(t.status==="erledigt"?" done":"")} key={t.id} aria-busy={pending.has(t.id)}>
 <button className="task-check" disabled={pending.has(t.id)} aria-label={t.status==="erledigt"?"Aufgabe wieder öffnen":"Aufgabe erledigen"} onClick={()=>patch(t,{status:t.status==="erledigt"?"offen":"erledigt"})}>{t.status==="erledigt"&&<Icon name="check" size={14}/>}</button>
 <div className="task-body"><div className="task-title">{t.title}</div>{t.note&&<div className="task-note">{t.note}</div>}<div className="task-meta">{t.due_at?new Date(t.due_at).toLocaleDateString("de-DE"):"Ohne Frist"} · {t.priority==="hoch"?"Hohe Priorität · ":""}{t.source==="manuell"?"Manuell":t.source}</div></div>
 <div className="task-actions">{t.status!=="erledigt"&&<button className="icon-button" disabled={pending.has(t.id)} title={t.status==="warten"?"Wieder aufnehmen":"Auf Rückmeldung warten"} aria-label={t.status==="warten"?"Wieder aufnehmen":"Auf Rückmeldung warten"} onClick={()=>patch(t,{status:t.status==="warten"?"offen":"warten"})}><Icon name={t.status==="warten"?"refresh":"clock"}/></button>}<button className="icon-button" aria-label="Aufgabe löschen" disabled={pending.has(t.id)} onClick={()=>remove(t)}><Icon name="trash"/></button></div>
 </article>)}</section>:null;})}
 {!visible.length&&<div className="empty"><Icon name="tasks" size={30}/><p>{query?"Keine passenden Aufgaben.":"Hier ist alles erledigt."}</p><div className="sub">Neue Aufgaben können auch ohne Datum angelegt werden.</div></div>}
 </div></div>;
}

import type { CalendarEvent } from "./googleCalendar";
import { supabaseAdmin } from "./supabaseAdmin";
import {
  automaticFocusCategory, calendarFocusSignature, classifyCalendarFocus,
  focusKindFromCategory, isFocusKind, isManualFocusCategory
} from "./calendarFocus";
import { keepCurrentTask } from "./taskDates";

export interface CalendarTaskSyncResult { taskIds:Map<string,string>; synced:number; deleted:number }
type ExistingCalendarTask={id:string;external_id:string;status:string|null;category:string|null;title:string|null;calendar_name:string|null};
export type CalendarEventKind="task"|"ignoredHard"|"ignoredSoft"|"skip";

function allDayInstant(value:string|null):string|null {
  if(!value) return null;
  const date=value.slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?`${date}T12:00:00.000Z`:null;
}

export function classifyCalendarEvent(event:CalendarEvent):CalendarEventKind {
  const decision=classifyCalendarFocus(event);
  if(decision.focus) return "task";
  if(event.recurring&&event.recurrenceInstance) return "skip";
  if(decision.kind==="holiday"||decision.kind==="travel") return "ignoredHard";
  return "ignoredSoft";
}
export const isTaskWorthyEvent=(event:CalendarEvent)=>classifyCalendarFocus(event).focus;

export function calendarEventTaskRecord(
  userId:string,event:CalendarEvent,existingStatus?:string|null,category?:string|null
):Record<string,unknown> {
  const decision=classifyCalendarFocus(event);
  const startsAt=event.allDay?allDayInstant(event.start):new Date(event.start).toISOString();
  const endsAt=event.allDay?allDayInstant(event.end):event.end?new Date(event.end).toISOString():null;
  if(!startsAt) throw new Error("Kalendertermin hat kein gültiges Startdatum.");
  return {
    user_id:userId,title:event.title||"(ohne Titel)",note:event.description||null,
    priority:decision.kind==="deadline"||decision.kind==="important_event"?"hoch":"normal",
    due_at:startsAt,starts_at:startsAt,ends_at:endsAt,all_day:event.allDay,location:event.location||null,
    status:existingStatus|| (decision.focus?"offen":"ignoriert"),
    category:category||automaticFocusCategory(decision.kind),source:"icloud_calendar",calendar_name:event.calendar,
    external_id:event.id,linked_calendar_event_id:event.id,external_url:event.htmlLink||null,
    synced_at:new Date().toISOString(),updated_at:new Date().toISOString()
  };
}

export function staleExternalIds(existing:Array<{external_id:string}>,incoming:Iterable<string>):string[] {
  const seen=new Set(incoming);
  return existing.map((item)=>item.external_id).filter((id)=>!!id&&!seen.has(id));
}
function chunks<T>(items:T[],size=200):T[][] {
  const out:T[][]=[]; for(let i=0;i<items.length;i+=size) out.push(items.slice(i,i+size)); return out;
}

export async function syncIcloudTasks(userId:string,inputEvents:CalendarEvent[],timeMin:string,timeMax:string):Promise<CalendarTaskSyncResult> {
  const admin=supabaseAdmin();
  const {data:known,error:knownError}=await admin.from("tasks")
    .select("id,external_id,status,category,title,calendar_name")
    .eq("user_id",userId).eq("source","icloud_calendar").limit(2000);
  if(knownError) throw new Error("Kalenderverknüpfungen konnten nicht gelesen werden.");
  const knownTasks=(known||[]) as ExistingCalendarTask[];
  const existingById=new Map(knownTasks.map((task)=>[task.external_id,task]));
  const manualBySignature=new Map<string,ExistingCalendarTask>();
  for(const task of knownTasks) {
    if(isManualFocusCategory(task.category)) manualBySignature.set(calendarFocusSignature(task.title,task.calendar_name),task);
  }

  const events:CalendarEvent[]=[];
  const stateById=new Map<string,{status:string;category:string}>();
  const uniqueEvents=new Map(inputEvents.map((event)=>[event.id,event]));
  for(const event of uniqueEvents.values()) {
    if(!keepCurrentTask({title:event.title,due_at:event.start})) continue;
    const decision=classifyCalendarFocus(event);
    const existing=existingById.get(event.id);
    const inherited=manualBySignature.get(calendarFocusSignature(event.title,event.calendar));
    const manual=existing&&isManualFocusCategory(existing.category)?existing:inherited;
    const manualKind=focusKindFromCategory(manual?.category);
    const manualShows=!!manualKind&&isFocusKind(manualKind);
    const manualHides=!!manual&&!manualShows;
    if(event.recurring&&event.recurrenceInstance&&!decision.focus&&!manualShows) continue;

    let category=automaticFocusCategory(decision.kind);
    let status=decision.focus?"offen":"ignoriert";
    if(manual) {
      category=manual.category||category;
      status=manualHides?"ignoriert":"offen";
    }
    if(existing&&isManualFocusCategory(existing.category)) {
      category=existing.category!;
      status=existing.status||status;
    } else if(existing&&decision.focus&&["offen","warten","erledigt"].includes(existing.status||"")) {
      status=existing.status!;
    }
    stateById.set(event.id,{status,category});
    events.push(event);
  }

  const incomingIds=events.map((event)=>event.id);
  const records=events.map((event)=>{
    const state=stateById.get(event.id)!;
    return calendarEventTaskRecord(userId,event,state.status,state.category);
  });
  for(const batch of chunks(records)) {
    if(!batch.length) continue;
    const {error}=await admin.from("tasks").upsert(batch,{onConflict:"user_id,source,external_id"});
    if(error) throw new Error("Kalendertermine konnten nicht mit Aufgaben & Fristen synchronisiert werden.");
  }

  const taskIds=new Map<string,string>();
  for(const batch of chunks(incomingIds)) {
    if(!batch.length) continue;
    const {data,error}=await admin.from("tasks").select("id,external_id").eq("user_id",userId).eq("source","icloud_calendar").in("external_id",batch);
    if(error) throw new Error("Kalenderverknüpfungen konnten nicht bestätigt werden.");
    for(const task of data||[]) taskIds.set(task.external_id,task.id);
  }

  const {data:previous,error:previousError}=await admin.from("tasks").select("id,external_id")
    .eq("user_id",userId).eq("source","icloud_calendar")
    .gte("starts_at",new Date(timeMin).toISOString()).lt("starts_at",new Date(timeMax).toISOString());
  if(previousError) throw new Error("Vorherige Kalendertermine konnten nicht abgeglichen werden.");
  const stale=staleExternalIds((previous||[]) as Array<{external_id:string}>,incomingIds);
  let deleted=0;
  for(const batch of chunks(stale)) {
    const {error,count}=await admin.from("tasks").delete({count:"exact"}).eq("user_id",userId).eq("source","icloud_calendar").in("external_id",batch);
    if(error) throw new Error("Gelöschte Kalendertermine konnten nicht abgeglichen werden.");
    deleted+=count||0;
  }
  return {taskIds,synced:events.length,deleted};
}
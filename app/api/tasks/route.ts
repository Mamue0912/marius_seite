import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { taskDueDate, taskNote, taskTitle, validTaskPriority, validTaskStatus } from "@/lib/taskValidation";
import { isFocusKind, manualFocusCategory, type CalendarFocusKind } from "@/lib/calendarFocus";
import { keepCurrentTask } from "@/lib/taskDates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const serverError = (message: string) => NextResponse.json({ error: "db_error", message }, { status: 500 });
const badRequest = (error: unknown) => NextResponse.json({ error: "bad_request", message: error instanceof Error ? error.message : "Ungültiger Eintrag." }, { status: 400 });
function shortText(value: unknown, max: number, fallback: string | null = null): string | null { if (value == null || value === "") return fallback; if (typeof value !== "string") throw new Error("Ein Textfeld ist ungültig."); return value.trim().slice(0,max) || fallback; }
const FOCUS_KINDS: CalendarFocusKind[] = ["task","deadline","important_event","routine","training","travel","holiday","informational","personal","possible"];
const validFocusKind = (value: unknown): value is CalendarFocusKind => typeof value === "string" && FOCUS_KINDS.includes(value as CalendarFocusKind);

export async function GET() {
  const user=await requireUser(); if(!user) return NextResponse.json({error:"unauthorized"},{status:401});
  const {data,error}=await supabaseAdmin().from("tasks").select("*").eq("user_id",user.id).order("created_at",{ascending:false});
  if(error) return serverError("Aufgaben & Fristen konnten nicht geladen werden.");
  return NextResponse.json({tasks:(data||[]).filter((task)=>keepCurrentTask(task))});
}

export async function POST(req: NextRequest) {
  const user=await requireUser(); if(!user) return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await req.json().catch(()=>null); if(!body) return badRequest(new Error("Ungültige Eingabe."));
  try {
    if(body.priority!=null && !validTaskPriority(body.priority)) throw new Error("Die Priorität ist ungültig.");
    const dueAt=taskDueDate(body.due_at);
    if(!dueAt && body.allow_no_date!==true) throw new Error("Bitte ein Datum wählen oder bewusst ohne Datum speichern.");
    const insert={ user_id:user.id,title:taskTitle(body.title),note:taskNote(body.note),priority:body.priority||"normal",due_at:dueAt,starts_at:dueAt,status:"offen",source:"manuell",category:shortText(body.category,100,"Sonstiges"),reminder_at:taskDueDate(body.reminder_at) };
    const {data,error}=await supabaseAdmin().from("tasks").insert(insert).select().single();
    if(error||!data) return serverError("Aufgabe oder Frist konnte nicht gespeichert werden.");
    return NextResponse.json({task:data});
  } catch(error) { return badRequest(error); }
}

export async function PATCH(req: NextRequest) {
  const user=await requireUser(); if(!user) return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await req.json().catch(()=>null); if(!body||typeof body.id!=="string"||!body.id) return badRequest(new Error("Eintrag fehlt."));
  const admin=supabaseAdmin();
  const {data:existing,error:lookupError}=await admin.from("tasks").select("*").eq("id",body.id).eq("user_id",user.id).maybeSingle();
  if(lookupError) return serverError("Eintrag konnte nicht geprüft werden.");
  if(!existing) return NextResponse.json({error:"not_found",message:"Eintrag wurde nicht gefunden."},{status:404});
  const patch:Record<string,unknown>={updated_at:new Date().toISOString()};
  try {
    if("status" in body){
      if(!validTaskStatus(body.status)) throw new Error("Der Status ist ungültig.");
      patch.status=body.status;
      if(existing.source==="icloud_calendar" && body.status==="ignoriert") patch.category=manualFocusCategory("hidden");
      if(existing.source==="icloud_calendar" && body.status==="offen" && String(existing.category||"").endsWith("Ausgeblendet")) patch.category=manualFocusCategory("important_event");
    }
    if(existing.source==="icloud_calendar" && "focus_kind" in body){
      if(!validFocusKind(body.focus_kind)) throw new Error("Die Fokus-Kategorie ist ungültig.");
      patch.category=manualFocusCategory(body.focus_kind);
      patch.status=isFocusKind(body.focus_kind)?"offen":"ignoriert";
    }
    if(existing.source==="icloud_calendar" && "focus_override" in body){
      if(body.focus_override!=="show" && body.focus_override!=="hide") throw new Error("Die Fokus-Auswahl ist ungültig.");
      if(body.focus_override==="hide") { patch.status="ignoriert"; patch.category=manualFocusCategory("hidden"); }
      else { patch.status="offen"; patch.category=manualFocusCategory(validFocusKind(body.focus_kind)?body.focus_kind:"important_event"); }
    }
    if("reminder_at" in body) patch.reminder_at=taskDueDate(body.reminder_at);
    if(!existing.external_id){
      if("title" in body) patch.title=taskTitle(body.title);
      if("note" in body) patch.note=taskNote(body.note);
      if("due_at" in body){patch.due_at=taskDueDate(body.due_at);patch.starts_at=taskDueDate(body.due_at);}
      if("priority" in body){if(!validTaskPriority(body.priority)) throw new Error("Die Priorität ist ungültig.");patch.priority=body.priority;}
      if("category" in body) patch.category=shortText(body.category,100,"Sonstiges");
    }
  } catch(error){return badRequest(error);}
  const {data,error}=await admin.from("tasks").update(patch).eq("id",body.id).eq("user_id",user.id).select().maybeSingle();
  if(error) return serverError("Eintrag konnte nicht gespeichert werden.");
  return NextResponse.json({task:data});
}
export async function DELETE(req: NextRequest) {
  const user=await requireUser(); if(!user) return NextResponse.json({error:"unauthorized"},{status:401});
  const body=await req.json().catch(()=>null); if(!body||typeof body.id!=="string"||!body.id) return badRequest(new Error("Eintrag fehlt."));
  const admin=supabaseAdmin(); const {data:task,error:lookupError}=await admin.from("tasks").select("external_id").eq("id",body.id).eq("user_id",user.id).maybeSingle();
  if(lookupError) return serverError("Eintrag konnte nicht geprüft werden.");
  if(!task) return NextResponse.json({error:"not_found",message:"Eintrag wurde nicht gefunden."},{status:404});
  if(task.external_id) return NextResponse.json({error:"managed",message:"Synchronisierte Einträge werden an ihrer Quelle verwaltet."},{status:409});
  const {error}=await admin.from("tasks").delete().eq("id",body.id).eq("user_id",user.id); if(error) return serverError("Eintrag konnte nicht gelöscht werden.");
  return NextResponse.json({ok:true});
}
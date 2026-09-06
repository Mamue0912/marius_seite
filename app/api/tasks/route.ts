import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  taskDueDate,
  taskNote,
  taskTitle,
  validTaskPriority,
  validTaskSource,
  validTaskStatus
} from "@/lib/taskValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serverError(message: string) {
  return NextResponse.json({ error: "db_error", message }, { status: 500 });
}

function badRequest(error: unknown) {
  return NextResponse.json({ error: "bad_request", message: error instanceof Error ? error.message : "Ungültige Aufgabe." }, { status: 400 });
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin().from("tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) return serverError("Aufgaben konnten nicht geladen werden.");
  return NextResponse.json({ tasks: data || [] });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return badRequest(new Error("Ungültige Eingabe."));

  let insert: Record<string, unknown>;
  try {
    if (body.priority != null && !validTaskPriority(body.priority)) throw new Error("Die Priorität ist ungültig.");
    if (body.status != null && !validTaskStatus(body.status)) throw new Error("Der Status ist ungültig.");
    if (body.source != null && !validTaskSource(body.source)) throw new Error("Die Quelle ist ungültig.");
    insert = {
      user_id: user.id,
      title: taskTitle(body.title),
      note: taskNote(body.note),
      priority: body.priority || "normal",
      due_at: taskDueDate(body.due_at),
      status: body.status || "offen",
      source: body.source || "manuell",
      linked_message_id: body.linked_message_id || null
    };
  } catch (error) {
    return badRequest(error);
  }

  const { data, error } = await supabaseAdmin().from("tasks").insert(insert).select().single();
  if (error || !data) return serverError("Aufgabe konnte nicht gespeichert werden.");
  return NextResponse.json({ task: data });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string" || !body.id) return badRequest(new Error("Aufgabe fehlt."));

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  try {
    if ("title" in body) patch.title = taskTitle(body.title);
    if ("note" in body) patch.note = taskNote(body.note);
    if ("due_at" in body) patch.due_at = taskDueDate(body.due_at);
    if ("priority" in body) {
      if (!validTaskPriority(body.priority)) throw new Error("Die Priorität ist ungültig.");
      patch.priority = body.priority;
    }
    if ("status" in body) {
      if (!validTaskStatus(body.status)) throw new Error("Der Status ist ungültig.");
      patch.status = body.status;
    }
  } catch (error) {
    return badRequest(error);
  }

  const { data, error } = await supabaseAdmin().from("tasks").update(patch).eq("id", body.id).eq("user_id", user.id).select().maybeSingle();
  if (error) return serverError("Aufgabe konnte nicht gespeichert werden.");
  if (!data) return NextResponse.json({ error: "not_found", message: "Aufgabe wurde nicht gefunden." }, { status: 404 });
  return NextResponse.json({ task: data });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string" || !body.id) return badRequest(new Error("Aufgabe fehlt."));
  const { error } = await supabaseAdmin().from("tasks").delete().eq("id", body.id).eq("user_id", user.id);
  if (error) return serverError("Aufgabe konnte nicht gelöscht werden.");
  return NextResponse.json({ ok: true });
}
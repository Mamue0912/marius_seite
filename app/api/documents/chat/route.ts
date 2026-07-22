import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { documentsChatReply, aiConfigured, aiErrorInfo } from "@/lib/anthropic";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kontext aus allen Unterlagen (gekürzter Text) + Fakten aufbauen.
async function buildContext(userId: string) {
  const admin = supabaseAdmin();
  const { data: docs } = await admin.from("app_documents").select("name,doc_type,extracted_text").eq("user_id", userId).order("created_at", { ascending: false });
  const { data: facts } = await admin.from("app_document_facts").select("category,value,status").eq("user_id", userId);
  const docsContext = (docs || [])
    .map((d) => `# ${d.name}${d.doc_type ? ` (${d.doc_type})` : ""}\n${(d.extracted_text || "(kein extrahierter Text – evtl. Bild/Scan)").slice(0, 4000)}`)
    .join("\n\n---\n\n");
  const byStatus: Record<string, string[]> = {};
  for (const f of facts || []) {
    const key = f.status === "bestaetigt" ? "bestätigt" : f.status === "abgelehnt" ? "abgelehnt" : "offen";
    (byStatus[key] ||= []).push(`${f.category}: ${f.value}`);
  }
  const factsText = Object.entries(byStatus).map(([k, v]) => `[${k}]\n- ${v.join("\n- ")}`).join("\n\n");
  return { docsContext, factsText };
}

// GET: bisherige Chat-Historie (leer, falls Tabelle fehlt).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { data } = await supabaseAdmin().from("document_messages").select("id,role,content,created_at").eq("user_id", user.id).order("created_at", { ascending: true }).limit(100);
    return NextResponse.json({ messages: data || [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

// POST: neue Nachricht → KI-Antwort mit Unterlagen-Kontext.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist nicht vollständig eingerichtet." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const message: string = (body.message || "").trim();
  const history: any[] = Array.isArray(body.history) ? body.history.slice(-20) : [];
  if (!message) return NextResponse.json({ error: "bad_request", message: "Keine Nachricht." }, { status: 400 });

  const admin = supabaseAdmin();
  // Nutzernachricht best-effort speichern (Historie optional).
  try { await admin.from("document_messages").insert({ user_id: user.id, role: "user", content: message }); } catch {}

  const started = Date.now();
  try {
    const { docsContext, factsText } = await buildContext(user.id);
    const reply = await documentsChatReply({
      docsContext, factsText,
      history: history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") })),
      userMessage: message
    });
    let saved: any = { id: "a" + Date.now(), role: "assistant", content: reply };
    try { const { data } = await admin.from("document_messages").insert({ user_id: user.id, role: "assistant", content: reply }).select("*").single(); if (data) saved = data; } catch {}
    await recordAiEvent({ userId: user.id, kind: "compose", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: "unterlagen-chat" });
    return NextResponse.json({ reply, message: saved });
  } catch (e) {
    const info = aiErrorInfo(e);
    await recordAiEvent({ userId: user.id, kind: "compose", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: "unterlagen-chat" });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

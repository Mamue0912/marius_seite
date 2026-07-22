import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { JobAnalysis } from "@/lib/anthropic";

// Baut die Kontexttexte für Chat & Dokumenterstellung serverseitig auf.
// Nutzt ausschließlich BESTÄTIGTE Fakten des Nutzers.

export async function confirmedFactsText(userId: string): Promise<string> {
  const { data } = await supabaseAdmin()
    .from("app_document_facts")
    .select("category,value")
    .eq("user_id", userId).eq("status", "bestaetigt")
    .order("category", { ascending: true });
  if (!data || !data.length) return "";
  const byCat: Record<string, string[]> = {};
  for (const f of data) (byCat[f.category] ||= []).push(f.value);
  return Object.entries(byCat)
    .map(([cat, vals]) => `- ${cat}: ${vals.join("; ")}`)
    .join("\n");
}

export function jobContextText(app: any): string {
  const a: JobAnalysis | null = app?.analysis || null;
  const lines: string[] = [];
  if (app?.company) lines.push(`Unternehmen: ${app.company}`);
  if (app?.position) lines.push(`Position: ${app.position}`);
  if (app?.job_type) lines.push(`Art: ${app.job_type}`);
  if (app?.deadline) lines.push(`Frist: ${app.deadline}`);
  if (app?.contact) lines.push(`Ansprechpartner: ${app.contact}`);
  if (a) {
    if (a.summary) lines.push(`\nZusammenfassung: ${a.summary}`);
    if (a.tasks?.length) lines.push(`Aufgaben: ${a.tasks.join("; ")}`);
    if (a.requirements_must?.length) lines.push(`Zwingende Voraussetzungen: ${a.requirements_must.join("; ")}`);
    if (a.requirements_nice?.length) lines.push(`Wünschenswert: ${a.requirements_nice.join("; ")}`);
    if (a.documents_required?.length) lines.push(`Verlangte Unterlagen: ${a.documents_required.join("; ")}`);
    if (a.application_tips?.length) lines.push(`Hinweise: ${a.application_tips.join("; ")}`);
  }
  if (!a && app?.job_text) lines.push(`\nStellentext (Auszug):\n${String(app.job_text).slice(0, 3000)}`);
  return lines.join("\n");
}

export async function generatedDocsContext(userId: string, applicationId: string): Promise<string> {
  const { data } = await supabaseAdmin()
    .from("application_docs")
    .select("kind,title,body,updated_at")
    .eq("user_id", userId).eq("application_id", applicationId)
    .order("updated_at", { ascending: false }).limit(4);
  if (!data || !data.length) return "";
  return data.map((d) => `[${d.kind}] ${d.title || ""}\n${String(d.body).slice(0, 1200)}`).join("\n\n---\n\n");
}

export async function chatHistory(userId: string, applicationId: string, limit = 20): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await supabaseAdmin()
    .from("application_messages")
    .select("role,content,created_at")
    .eq("user_id", userId).eq("application_id", applicationId)
    .order("created_at", { ascending: true }).limit(limit);
  return (data || []).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
}

// Owner-geprüftes Laden einer Bewerbung.
export async function loadApplication(userId: string, id: string): Promise<any | null> {
  const { data } = await supabaseAdmin().from("applications").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data || null;
}

export async function touchApplication(id: string): Promise<void> {
  await supabaseAdmin().from("applications").update({ last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
}

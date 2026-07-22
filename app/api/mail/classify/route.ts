import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { classifyMessage } from "@/lib/classify2";
import { loadRules, applyRules } from "@/lib/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 150;

async function counts(userId: string) {
  const admin = supabaseAdmin();
  const total = (await admin.from("messages").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_deleted", false)).count || 0;
  const remaining = (await admin.from("messages").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_deleted", false).is("classified_at", null)).count || 0;
  return { total, remaining, classified: total - remaining };
}

// GET: Fortschritt der Klassifizierung.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await counts(user.id));
}

// POST: klassifiziert einen Stapel noch nicht eingeordneter Mails.
//  ?reset=1  → setzt alle als "nicht klassifiziert" (Neu-Einordnung erzwingen)
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();

  if (new URL(req.url).searchParams.get("reset") === "1") {
    await admin.from("messages").update({ classified_at: null }).eq("user_id", user.id).eq("is_deleted", false);
    return NextResponse.json({ ...(await counts(user.id)), reset: true });
  }

  const rules = await loadRules(user.id);
  const { data: batch } = await admin.from("messages")
    .select("id,from_address,from_name,reply_to_addresses,subject,preview,is_bulk,has_list_unsub,folder_type,in_reply_to,classification_source,mail_account_id")
    .eq("user_id", user.id).eq("is_deleted", false).is("classified_at", null)
    .order("received_at", { ascending: false }).limit(BATCH);

  let processed = 0;
  for (const m of batch || []) {
    const res = classifyMessage({
      from_address: m.from_address, from_name: m.from_name, reply_to: m.reply_to_addresses,
      subject: m.subject, preview: m.preview, is_bulk: m.is_bulk, has_list_unsub: m.has_list_unsub,
      folder_type: m.folder_type, in_thread: !!m.in_reply_to
    });
    const now = new Date().toISOString();
    // Nutzer-Overrides niemals überschreiben – nur Zusammenfassung/Zeitstempel.
    if (m.classification_source === "user_override") {
      await admin.from("messages").update({ summary: res.summary, classified_at: now }).eq("id", m.id);
      processed++; continue;
    }
    const update: any = {
      labels: res.labels, message_type: res.message_type, action_status: res.action_status,
      relevance: res.relevance, priority: res.priority, needs_reply: res.needs_reply,
      summary: res.summary, classified_at: now, classification_source: "auto"
    };
    // Nutzerregeln (immer als Label / nie antwortpflichtig / Kategorie) anwenden.
    const r = applyRules(rules, m);
    if (r.matched) {
      if (r.label) { const set = new Set(res.labels); set.add(r.label); update.labels = Array.from(set); }
      if (r.category) update.semantic_category = r.category;
      if (r.hidden) update.hidden = true;
      if (r.needs_reply === false) { update.needs_reply = false; update.action_status = "no_action"; }
      if (r.needs_reply === true) { update.needs_reply = true; update.action_status = "reply_required"; }
      update.classification_source = "rule";
    }
    await admin.from("messages").update(update).eq("id", m.id);
    processed++;
  }

  const c = await counts(user.id);
  return NextResponse.json({ processed, ...c });
}

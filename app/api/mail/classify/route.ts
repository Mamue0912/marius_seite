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
  const [totalResult, remainingResult] = await Promise.all([
    admin.from("messages").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_deleted", false),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_deleted", false).is("classified_at", null)
  ]);
  if (totalResult.error || remainingResult.error) throw new Error("Klassifizierungsstand konnte nicht geladen werden.");
  const total = totalResult.count || 0;
  const remaining = remainingResult.count || 0;
  return { total, remaining, classified: total - remaining };
}

// GET: Fortschritt der Klassifizierung.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await counts(user.id)); }
  catch (error) { return NextResponse.json({ error: "db_error", message: (error as Error).message }, { status: 500 }); }
}

// POST: klassifiziert einen Stapel noch nicht eingeordneter Mails.
//  ?reset=1  → setzt alle als "nicht klassifiziert" (Neu-Einordnung erzwingen)
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = supabaseAdmin();

  if (new URL(req.url).searchParams.get("reset") === "1") {
    const { error } = await admin.from("messages").update({ classified_at: null }).eq("user_id", user.id).eq("is_deleted", false);
    if (error) return NextResponse.json({ error: "db_error", message: "Neu-Einordnung konnte nicht gestartet werden." }, { status: 500 });
    return NextResponse.json({ ...(await counts(user.id)), reset: true });
  }

  const rules = await loadRules(user.id);
  // Zwei-Stufen-Select: fällt auf garantierte Basisspalten zurück, falls eine
  // erweiterte Spalte noch fehlt – so scheitert die Einordnung nie komplett.
  const SAFE = "id,from_address,from_name,subject,preview,mail_account_id";
  const FULL = SAFE + ",folder_type,reply_to_addresses,is_bulk,has_list_unsub,in_reply_to,user_labels";
  let sel: any = await admin.from("messages").select(FULL).eq("user_id", user.id).eq("is_deleted", false).is("classified_at", null).order("received_at", { ascending: false }).limit(BATCH);
  if (sel.error) {
    sel = await admin.from("messages").select(SAFE).eq("user_id", user.id).eq("is_deleted", false).is("classified_at", null).order("received_at", { ascending: false }).limit(BATCH);
  }
  if (sel.error) {
    return NextResponse.json({ processed: 0, error: "DB-Abfrage fehlgeschlagen: " + sel.error.message, ...(await counts(user.id)) });
  }
  const batch: any[] = sel.data || [];

  let processed = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const m of batch || []) {
    const res = classifyMessage({
      from_address: m.from_address, from_name: m.from_name, reply_to: m.reply_to_addresses,
      subject: m.subject, preview: m.preview, is_bulk: m.is_bulk, has_list_unsub: m.has_list_unsub,
      folder_type: m.folder_type, in_thread: !!m.in_reply_to
    });
    const now = new Date().toISOString();
    // Nutzerkorrekturen bleiben erhalten: user_*-Felder werden nie geschrieben,
    // und die UI liest user_* mit Vorrang. Basiswerte dürfen wir neu setzen.
    const update: any = {
      labels: res.labels, message_type: res.message_type, action_status: res.action_status,
      relevance: res.relevance, priority: res.priority, needs_reply: res.needs_reply,
      summary: res.summary, classified_at: now, classification_source: "auto"
    };
    // Vorhandene Nutzer-Labels behalten (zusammenführen).
    if (Array.isArray(m.user_labels) && m.user_labels.length) update.labels = Array.from(new Set([...res.labels, ...m.user_labels]));
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
    // Fehlertolerant: Supabase wirft nicht, sondern liefert { error }. Schlägt
    // das volle Update fehl (z. B. weil eine Spalte noch fehlt), wird ein
    // minimales Update versucht, damit die Nachricht NICHT dauerhaft im Zustand
    // "Wird eingeordnet…" hängen bleibt.
    const { error: upErr } = await admin.from("messages").update(update).eq("id", m.id).eq("user_id", user.id);
    if (!upErr) { processed++; continue; }
    if (!firstError) firstError = upErr.message;
    failed++;
    await admin.from("messages").update({ summary: res.summary, classified_at: now, relevance: res.relevance, needs_reply: res.needs_reply }).eq("id", m.id).eq("user_id", user.id);
  }

  const c = await counts(user.id);
  return NextResponse.json({ processed, failed, error: firstError, ...c });
}

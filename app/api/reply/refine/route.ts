import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { buildThreadContext } from "@/lib/imapFetch";
import { refineDraft, aiConfigured, aiErrorInfo } from "@/lib/anthropic";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kurzer Bearbeitungsbefehl (Kürzer/Freundlicher/…) ODER manuell editierter Text.
// Verändert nur den Entwurf – sendet nicht.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { messageId, command, editedBody } = await req.json().catch(() => ({}));
  const admin = supabaseAdmin();

  const { data: msg, error: messageError } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (messageError) return NextResponse.json({ error: "db_error", message: "Der Entwurf konnte nicht geladen werden." }, { status: 500 });
  if (!msg || !msg.draft_body) return NextResponse.json({ error: "no_draft" }, { status: 404 });

  const started = Date.now();
  try {
    let body: string;
    if (editedBody != null) {
      if (typeof editedBody !== "string" || editedBody.length > 100_000) return NextResponse.json({ error: "bad_request", message: "Der Entwurf ist ungültig oder zu lang." }, { status: 400 });
      body = editedBody; // manuelle Bearbeitung direkt übernehmen (kein KI-Aufruf)
    } else {
      if (!aiConfigured()) return NextResponse.json({ error: "not_configured", message: "Die KI-Verbindung ist noch nicht vollständig eingerichtet." }, { status: 503 });
      const account = msg.mail_account_id ? await loadMailAccount(msg.mail_account_id) : null;
      if (!account || account.user_id !== user.id) return NextResponse.json({ error: "no_account", message: "Das zugehörige Mailkonto ist nicht verfügbar." }, { status: 400 });
      const thread = await buildThreadContext(account as MailAccount, msg);
      const r = await refineDraft({ body: msg.draft_body, command, thread });
      body = r.body;
    }

    const { error: saveError } = await admin.from("messages")
      .update({ draft_body: body, last_generated_at: new Date().toISOString() })
      .eq("id", msg.id)
      .eq("user_id", user.id);
    if (saveError) {
      if (editedBody == null) await recordAiEvent({ userId: user.id, kind: "refine", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: "database", subjectHint: msg.subject });
      return NextResponse.json({ error: "db_error", message: "Der Entwurf konnte nicht gespeichert werden." }, { status: 500 });
    }
    if (editedBody == null) await recordAiEvent({ userId: user.id, kind: "refine", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: msg.subject });
    return NextResponse.json({ body });
  } catch (e) {
    const info = aiErrorInfo(e);
    console.error("refine failed:", info.category, (e as Error).message);
    if (editedBody == null) await recordAiEvent({ userId: user.id, kind: "refine", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: msg.subject });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

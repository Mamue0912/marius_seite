import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { buildThreadContext } from "@/lib/imapFetch";
import { generateDraft, aiConfigured, aiErrorInfo } from "@/lib/anthropic";
import { accountContextLine } from "@/lib/accountContext";
import { recordAiEvent } from "@/lib/aiDiagnostics";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Phase 2: Zentrale, robuste KI-Antworterzeugung.
// Das Frontend schickt NUR eine Mail-ID (+ Reaktion/Anweisung/Ton/Länge).
// Der Server lädt Absender, Empfänger, Betreff, Thread und Konto selbst –
// dem Frontend wird kein vollständiger Mailinhalt anvertraut.
// Verständliche Fehler, serverseitiges Zeitlimit, Diagnose-Protokoll.
export async function POST(req: NextRequest) {
  const started = Date.now();
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // KI gar nicht eingerichtet → sofort verständlich melden (kein Hänger).
  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "Die KI-Verbindung ist noch nicht vollständig eingerichtet." },
      { status: 503 }
    );
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* leerer Body */ }
  const { messageId, intent, intentLabel, customInstruction, tone, length } = body;
  if (!messageId) return NextResponse.json({ error: "bad_request", message: "Keine Mail angegeben." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: "not_found", message: "Nachricht nicht gefunden." }, { status: 404 });
  const account = msg.mail_account_id ? await loadMailAccount(msg.mail_account_id) : null;
  if (!account) return NextResponse.json({ error: "no_account", message: "Zu dieser Nachricht ist kein Konto verknüpft." }, { status: 400 });

  try {
    // Vollständigen Thread serverseitig aufbauen (Absender/Betreff/Verlauf).
    const thread = await buildThreadContext(account as MailAccount, msg);
    const draft = await generateDraft({
      thread, intent, intentLabel, customInstruction,
      tone: tone || "Professionell",
      length: length || undefined,
      accountContext: accountContextLine(account as MailAccount)
    });

    await admin.from("messages").update({
      selected_reply_intent: intent || "custom",
      custom_instruction: customInstruction || null,
      draft_body: draft.body,
      draft_subject: draft.subject,
      draft_language: draft.language,
      draft_tone: draft.tone,
      draft_binding: draft.binding,
      draft_needs_attachment: draft.needs_attachment,
      draft_missing_info: draft.missing_info,
      draft_status: "entwurf",
      last_generated_at: new Date().toISOString()
    }).eq("id", msg.id);

    await recordAiEvent({ userId: user.id, kind: "generate", ok: true, durationMs: Date.now() - started, model: env.anthropicModel(), subjectHint: msg.subject });
    return NextResponse.json({ draft, fromAccount: { email: (account as any).email, provider: (account as any).provider } });
  } catch (e) {
    const info = aiErrorInfo(e);
    console.error("generate-reply failed:", info.category, (e as Error).message);
    await recordAiEvent({ userId: user.id, kind: "generate", ok: false, durationMs: Date.now() - started, model: env.anthropicModel(), errorCategory: info.category, subjectHint: msg.subject });
    return NextResponse.json({ error: info.category, message: info.message }, { status: info.category === "not_configured" ? 503 : 502 });
  }
}

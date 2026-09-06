import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, loadMailAccounts, MailAccount } from "@/lib/mailAccounts";
import { sendMail } from "@/lib/mailSend";
import { friendlyMailError } from "@/lib/mailErrors";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Versendet den Entwurf per SMTP – NUR nach ausdrücklicher Bestätigung und nur
// wenn ENABLE_SEND aktiv ist. Absenderkonto = Empfangskonto (oder gewähltes).
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!env.enableSend()) {
    return NextResponse.json({ error: "send_disabled", message: "Versand ist nicht aktiviert (ENABLE_SEND=false)." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || body.confirm !== true) return NextResponse.json({ error: "confirmation_required", message: "Bitte den Versand ausdrücklich bestätigen." }, { status: 400 });
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  if (!messageId) return NextResponse.json({ error: "bad_request", message: "Keine Nachricht ausgewählt." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: message, error: messageError } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (messageError) return NextResponse.json({ error: "db_error", message: "Die Nachricht konnte nicht geladen werden." }, { status: 500 });
  if (!message || !message.draft_body) return NextResponse.json({ error: "no_draft", message: "Kein gespeicherter Entwurf vorhanden." }, { status: 404 });
  if (!message.from_address) return NextResponse.json({ error: "no_recipient", message: "Kein Empfänger vorhanden." }, { status: 400 });

  // Absenderkonto bestimmen (Standard: Empfangskonto; oder ausdrücklich gewählt).
  let account: MailAccount | null = null;
  if (body.fromAccountId) {
    const accounts = await loadMailAccounts(user.id);
    account = accounts.find((candidate) => candidate.id === body.fromAccountId) || null;
  } else if (message.mail_account_id) {
    const candidate = await loadMailAccount(message.mail_account_id);
    account = candidate?.user_id === user.id ? candidate : null;
  }
  if (!account) return NextResponse.json({ error: "no_account", message: "Kein gültiges Absenderkonto." }, { status: 400 });

  const subject = message.draft_subject || (message.subject ? `Re: ${message.subject.replace(/^re:\s*/i, "")}` : "Re:");
  const references = [message.message_refs, message.message_id].filter(Boolean).join(" ").trim() || null;

  try {
    const smtpMessageId = await sendMail(account, {
      to: message.from_address,
      subject,
      text: message.draft_body,
      inReplyTo: message.message_id || null,
      references,
      fromName: (account as any).display_name || null
    });

    const sentAt = new Date().toISOString();
    const { error: statusError } = await admin.from("messages").update({
      draft_status: "gesendet",
      reply_sent_at: sentAt,
      needs_reply: false
    }).eq("id", message.id).eq("user_id", user.id);

    return NextResponse.json({
      ok: true,
      sentAt,
      from: (account as any).email,
      messageId: smtpMessageId,
      warning: statusError ? "Die Antwort wurde versendet, der lokale Antwortstatus konnte aber nicht gespeichert werden." : undefined
    });
  } catch (caught) {
    console.error("send failed:", (caught as Error).message);
    return NextResponse.json({ error: "send_failed", message: friendlyMailError(caught as Error) }, { status: 502 });
  }
}
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

  const { messageId, confirm, fromAccountId } = await req.json();
  if (confirm !== true) return NextResponse.json({ error: "confirmation_required" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: msg } = await admin.from("messages").select("*").eq("id", messageId).eq("user_id", user.id).maybeSingle();
  if (!msg || !msg.draft_body) return NextResponse.json({ error: "no_draft" }, { status: 404 });
  if (!msg.from_address) return NextResponse.json({ error: "no_recipient" }, { status: 400 });

  // Absenderkonto bestimmen (Standard: Empfangskonto; oder ausdrücklich gewählt).
  let account: MailAccount | null = null;
  if (fromAccountId) {
    const accs = await loadMailAccounts(user.id);
    account = accs.find((a) => a.id === fromAccountId) || null;
  } else if (msg.mail_account_id) {
    account = await loadMailAccount(msg.mail_account_id);
  }
  if (!account) return NextResponse.json({ error: "no_account" }, { status: 400 });

  const subject = msg.draft_subject || (msg.subject ? `Re: ${msg.subject.replace(/^re:\s*/i, "")}` : "Re:");
  const references = [msg.message_refs, msg.message_id].filter(Boolean).join(" ").trim() || null;

  try {
    await sendMail(account, {
      to: msg.from_address,
      subject,
      text: msg.draft_body,
      inReplyTo: msg.message_id || null,
      references,
      fromName: (account as any).display_name || null
    });

    const sentAt = new Date().toISOString();
    await admin.from("messages").update({
      draft_status: "gesendet", reply_sent_at: sentAt, needs_reply: false
    }).eq("id", msg.id);

    return NextResponse.json({ ok: true, sentAt, from: (account as any).email });
  } catch (e) {
    console.error("send failed:", (e as Error).message);
    return NextResponse.json({ error: "send_failed", message: friendlyMailError(e as Error) }, { status: 502 });
  }
}

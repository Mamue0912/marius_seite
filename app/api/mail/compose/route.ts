import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts, MailAccount } from "@/lib/mailAccounts";
import { composeNew } from "@/lib/anthropic";
import { sendMail } from "@/lib/mailSend";
import { friendlyMailError } from "@/lib/mailErrors";
import { PROVIDERS } from "@/lib/mailProviders";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Zwei Aktionen:
//  action=draft  → KI formuliert aus kurzer Anweisung eine neue Mail (kein Versand)
//  action=send   → sendet die (bearbeitete) Mail über das gewählte Absenderkonto
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  const accounts = await loadMailAccounts(user.id);
  const account = accounts.find((a) => a.id === b.fromAccountId) as MailAccount | undefined;
  if (!account) return NextResponse.json({ error: "no_account" }, { status: 400 });

  if (b.action === "draft") {
    try {
      const label = `${PROVIDERS[account.provider]?.label || account.provider} · ${account.email}`;
      const draft = await composeNew({ instruction: String(b.instruction || ""), fromAccountLabel: label, recipientHint: b.to || "" });
      return NextResponse.json({ draft });
    } catch (e) {
      return NextResponse.json({ error: "generation_failed" }, { status: 502 });
    }
  }

  if (b.action === "send") {
    if (!env.enableSend()) return NextResponse.json({ error: "send_disabled" }, { status: 403 });
    if (b.confirm !== true) return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
    if (!b.to) return NextResponse.json({ error: "no_recipient" }, { status: 400 });
    try {
      await sendMail(account, {
        to: String(b.to), cc: b.cc || undefined, bcc: b.bcc || undefined,
        subject: String(b.subject || ""), text: String(b.body || ""),
        fromName: (account as any).display_name || null
      });
      return NextResponse.json({ ok: true, from: account.email });
    } catch (e) {
      return NextResponse.json({ error: "send_failed", message: friendlyMailError(e as Error) }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}

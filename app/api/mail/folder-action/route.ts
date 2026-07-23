import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { imapAction } from "@/lib/imapActions";
import { friendlyMailError } from "@/lib/mailErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Aktion auf eine Nachricht in einem on-demand-Ordner (Archiv/Junk/…),
// die nicht dauerhaft in der DB liegt: verschieben / gelesen markieren.
// action: inbox | trash | spam | archive | read | unread
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { account, path, uid, action } = await req.json().catch(() => ({}));
  if (!account || !path || !uid || !action) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const acc = await loadMailAccount(account);
  if (!acc || (acc as any).user_id !== user.id) return NextResponse.json({ error: "no_account" }, { status: 403 });
  try {
    const r = await imapAction(acc as MailAccount, path, parseInt(String(uid), 10), action);
    return NextResponse.json({ ok: true, movedTo: r.movedTo });
  } catch (e) {
    return NextResponse.json({ error: "action_failed", message: friendlyMailError(e as Error) }, { status: 502 });
  }
}

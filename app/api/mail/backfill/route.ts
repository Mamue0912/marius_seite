import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabaseServer";
import { loadMailAccounts, loadMailAccount, MailAccount } from "@/lib/mailAccounts";
import { backfillBatch } from "@/lib/imapSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 250;

// GET: Konten für den Backfill-Durchlauf.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const accounts = await loadMailAccounts(user.id);
  return NextResponse.json({ accounts: accounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider })) });
}

// POST { accountId, folder, startSeq }: einen Stapel prüfen.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { accountId, folder, startSeq } = await req.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const acc = await loadMailAccount(accountId);
  if (!acc || (acc as any).user_id !== user.id) return NextResponse.json({ error: "no_account" }, { status: 403 });
  const ftype = folder === "sent" ? "sent" : "inbox";
  try {
    const r = await backfillBatch(acc as MailAccount, ftype, Math.max(1, Number(startSeq) || 1), BATCH);
    return NextResponse.json({ ...r, folder: ftype, accountId });
  } catch (e) {
    return NextResponse.json({ error: "backfill_failed", message: (e as Error).message, folder: ftype, accountId }, { status: 502 });
  }
}

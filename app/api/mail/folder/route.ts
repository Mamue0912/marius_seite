import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { requireUser } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadMailAccount, MailAccount, accountPassword } from "@/lib/mailAccounts";
import { friendlyMailError } from "@/lib/mailErrors";
import { folderType } from "@/lib/folders";
import { classifyMessage, semanticCategoryOf } from "@/lib/classify2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

// Lädt die letzten Nachrichten eines beliebigen IMAP-Ordners bei Bedarf
// (für Ordner, die nicht dauerhaft in der DB liegen: Entwürfe/Archiv/Junk/…).
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const accountId = url.searchParams.get("account");
  const path = url.searchParams.get("path");
  if (!accountId || !path) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const acc = await loadMailAccount(accountId);
  if (!acc || acc.user_id !== user.id) return NextResponse.json({ error: "no_account" }, { status: 403 });
  const a = acc as MailAccount;

  const client = new ImapFlow({
    host: a.imap_host, port: a.imap_port, secure: (a as any).imap_secure !== false,
    auth: { user: a.username, pass: accountPassword(a) }, logger: false, socketTimeout: 30_000
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(path);
    const items: any[] = [];
    try {
      const exists = Number((client.mailbox as any)?.exists || 0);
      if (exists > 0) {
        const ftype = folderType(path, null);
        const start = Math.max(1, exists - 40 + 1);
        for await (const m of client.fetch(`${start}:*`, { uid: true, envelope: true, flags: true, internalDate: true })) {
          const env: any = m.envelope || {};
          const flags: Set<string> = m.flags instanceof Set ? m.flags : new Set(m.flags || []);
          // Deterministisch (ohne KI) einordnen, damit auch Junk/Archiv eine
          // Kategorie zeigen. Basis: Absender + Betreff (kein Body nötig).
          const cls = classifyMessage({
            from_address: env.from?.[0]?.address || null, from_name: env.from?.[0]?.name || null,
            subject: env.subject || null, folder_type: ftype
          });
          items.push({
            uid: m.uid, path, account_id: a.id,
            from_name: env.from?.[0]?.name || null, from_address: env.from?.[0]?.address || null,
            to_recipients: (env.to || []).map((x: any) => x.address).filter(Boolean).join(", "),
            subject: env.subject || null,
            received_at: m.internalDate ? new Date(m.internalDate).toISOString() : env.date ? new Date(env.date).toISOString() : null,
            is_read: flags.has("\\Seen"),
            semantic_category: semanticCategoryOf(cls),
            labels: cls.labels, relevance: cls.relevance, needs_reply: cls.needs_reply,
            action_status: cls.action_status, message_type: cls.message_type, summary: cls.summary,
            // Als eingeordnet markieren, damit die Liste nicht „Wird eingeordnet…" zeigt.
            classified_at: new Date().toISOString()
          });
        }
      }
    } finally {
      lock.release();
    }
    items.reverse();
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: friendlyMailError(e as Error) }, { status: 502 });
  } finally {
    await client.logout().catch(() => {});
  }
}

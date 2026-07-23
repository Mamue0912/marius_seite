import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { MailAccount, accountPassword } from "./mailAccounts";
import { ThreadMessage } from "./anthropic";
import { supabaseAdmin } from "./supabaseAdmin";

function client(acc: MailAccount): ImapFlow {
  return new ImapFlow({
    host: acc.imap_host,
    port: acc.imap_port,
    secure: (acc as any).imap_secure !== false,
    auth: { user: acc.username, pass: accountPassword(acc) },
    logger: false,
    socketTimeout: 45_000
  });
}

// Lädt den reinen Text einer Nachricht per UID aus dem angegebenen Ordner.
export async function fetchMessageText(acc: MailAccount, uid: number, mailbox = "INBOX"): Promise<string> {
  const c = client(acc);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const msg: any = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg?.source) return "";
      const parsed = await simpleParser(msg.source);
      return (parsed.text || parsed.html || "").toString();
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
}

// Lädt Text UND HTML einer Nachricht (für die Leseansicht).
export async function fetchMessageFull(acc: MailAccount, uid: number, mailbox = "INBOX", markRead = false): Promise<{ text: string; html: string | null }> {
  const c = client(acc);
  await c.connect();
  try {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const msg: any = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg?.source) return { text: "", html: null };
      const parsed = await simpleParser(msg.source);
      // Beim Öffnen als gelesen markieren (auch in Archiv/Junk-Ordnern).
      if (markRead) { try { await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch {} }
      return { text: (parsed.text || "").toString(), html: parsed.html ? String(parsed.html) : null };
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
}

// Baut den Thread-Kontext für die KI: aktuelle Nachricht (Volltext per IMAP) +
// vorherige Nachrichten derselben Unterhaltung aus der Datenbank (Kurzform).
export async function buildThreadContext(acc: MailAccount, msgRow: any): Promise<ThreadMessage[]> {
  const admin = supabaseAdmin();
  const out: ThreadMessage[] = [];

  // Vorherige Nachrichten im selben Thread (nur Metadaten/Vorschau).
  if (msgRow.thread_id) {
    const { data: prev } = await admin
      .from("messages")
      .select("from_name,from_address,subject,preview,received_at,folder_type")
      .eq("user_id", msgRow.user_id)
      .eq("thread_id", msgRow.thread_id)
      .neq("id", msgRow.id)
      .order("received_at", { ascending: true })
      .limit(12);
    for (const p of prev || []) {
      out.push({
        from: p.from_name || p.from_address || "(unbekannt)",
        date: p.received_at || "",
        direction: p.folder_type === "sent" ? "gesendet" : "eingehend",
        subject: p.subject || "",
        body: (p.preview || "").slice(0, 800)
      });
    }
  }

  // Aktuelle Nachricht mit Volltext.
  let body = msgRow.preview || "";
  const uid = extractUid(msgRow.web_link);
  if (uid) {
    try {
      const mailbox = msgRow.original_folder_name || "INBOX";
      body = (await fetchMessageText(acc, uid, mailbox)) || body;
    } catch {
      /* Fallback: Vorschau */
    }
  }
  out.push({
    from: msgRow.from_name || msgRow.from_address || "(unbekannt)",
    date: msgRow.received_at || "",
    direction: "eingehend",
    subject: msgRow.subject || "",
    body: body.slice(0, 4000)
  });
  return out;
}

export function extractUid(webLink?: string | null): number | null {
  const m = (webLink || "").match(/^imap-uid:(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

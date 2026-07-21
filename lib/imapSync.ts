import { ImapFlow } from "imapflow";
import { classify } from "./classify";
import { supabaseAdmin } from "./supabaseAdmin";
import { MailAccount, accountPassword } from "./mailAccounts";

// Wie viele Nachrichten beim ersten Verbinden geladen werden (Seed).
const SEED_COUNT = 40;

function makeClient(acc: MailAccount): ImapFlow {
  return new ImapFlow({
    host: acc.imap_host,
    port: acc.imap_port,
    secure: true, // 993 = implizites TLS
    auth: { user: acc.username, pass: accountPassword(acc) },
    logger: false,
    // Nicht ewig hängen bleiben (Serverless-Zeitlimit).
    socketTimeout: 45_000
  });
}

// Prüft nur, ob Login funktioniert (für den Verbinden-Dialog).
export async function verifyLogin(acc: MailAccount): Promise<void> {
  const client = makeClient(acc);
  await client.connect();
  await client.logout();
}

// Holt neue Nachrichten aus dem Posteingang und legt sie in messages ab.
// Gibt die Anzahl neu verarbeiteter Nachrichten zurück.
export async function syncInbox(acc: MailAccount): Promise<number> {
  const admin = supabaseAdmin();
  const client = makeClient(acc);
  let processed = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box: any = client.mailbox;
      const uidValidity = Number(box?.uidValidity || 0);
      const exists = Number(box?.exists || 0);
      if (exists === 0) {
        await admin
          .from("mail_accounts")
          .update({
            inbox_uidvalidity: uidValidity,
            last_synced_at: new Date().toISOString(),
            status: "connected",
            last_error: null
          })
          .eq("id", acc.id);
        return 0;
      }

      // UIDVALIDITY-Wechsel → Cursor zurücksetzen (Postfach neu aufgebaut).
      let lastUid = Number(acc.inbox_last_uid || 0);
      if (acc.inbox_uidvalidity && Number(acc.inbox_uidvalidity) !== uidValidity) {
        lastUid = 0;
      }

      let maxUid = lastUid;

      if (lastUid > 0) {
        // Inkrementell: nur UIDs größer als der zuletzt gesehene.
        // 3. Argument { uid: true } => Bereich als UID-Bereich interpretieren.
        for await (const msg of client.fetch(
          `${lastUid + 1}:*`,
          { uid: true, envelope: true, flags: true, internalDate: true },
          { uid: true }
        )) {
          if (Number(msg.uid) <= lastUid) continue; // Serverrand kann Grenze mitliefern
          await upsertMessage(acc, msg);
          processed++;
          if (Number(msg.uid) > maxUid) maxUid = Number(msg.uid);
        }
      } else {
        // Erstsync: die letzten SEED_COUNT Nachrichten (nach Sequenznummer).
        const start = Math.max(1, exists - SEED_COUNT + 1);
        for await (const msg of client.fetch(
          `${start}:*`,
          { uid: true, envelope: true, flags: true, internalDate: true }
        )) {
          await upsertMessage(acc, msg);
          processed++;
          if (Number(msg.uid) > maxUid) maxUid = Number(msg.uid);
        }
      }

      await admin
        .from("mail_accounts")
        .update({
          inbox_uidvalidity: uidValidity,
          inbox_last_uid: maxUid,
          last_synced_at: new Date().toISOString(),
          status: "connected",
          last_error: null
        })
        .eq("id", acc.id);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return processed;
}

async function upsertMessage(acc: MailAccount, msg: any): Promise<void> {
  const admin = supabaseAdmin();
  const env = msg.envelope || {};
  const fromAddr = env.from?.[0]?.address || null;
  const fromName = env.from?.[0]?.name || null;
  const to = (env.to || []).map((a: any) => a.address).filter(Boolean).join(", ");
  const received = msg.internalDate ? new Date(msg.internalDate).toISOString() : env.date ? new Date(env.date).toISOString() : null;
  const flags: Set<string> = msg.flags instanceof Set ? msg.flags : new Set(msg.flags || []);
  const isRead = flags.has("\\Seen");
  const messageId = env.messageId || `imap-${acc.id}-inbox-${msg.uid}`;

  const base = {
    folder: "inbox",
    from_address: fromAddr,
    from_name: fromName,
    subject: env.subject ?? null,
    preview: null as string | null,
    is_read: isRead,
    importance: null as string | null,
    received_at: received
  };
  const c = classify(base);

  const row = {
    user_id: acc.user_id,
    account_id: null,
    mail_account_id: acc.id,
    graph_id: messageId, // stabile ID für Dedupe (Message-ID)
    conversation_id: env.inReplyTo || null,
    internet_message_id: env.messageId || null,
    folder: "inbox",
    from_name: fromName,
    from_address: fromAddr,
    to_recipients: to || null,
    subject: env.subject ?? null,
    preview: null,
    received_at: received,
    sent_at: null,
    is_read: isRead,
    importance: null,
    needs_reply: c.needs_reply,
    deadline_at: c.deadline_at,
    detected_task: c.detected_task,
    category: c.category,
    status: c.status,
    // IMAP-UID hier ablegen, damit wir später den Volltext per IMAP nachladen können.
    web_link: `imap-uid:${msg.uid}`,
    last_modified_at: null,
    last_synced_at: new Date().toISOString(),
    hidden: c.hidden,
    is_deleted: false
  };

  await admin.from("messages").upsert(row, { onConflict: "user_id,graph_id" });
}
